import Redis from 'ioredis';
import { redisConfig, reconnectDelay } from '../src/config/redis.js';
import redisService, { RedisService } from '../src/services/redisService.js';
import cacheService from '../src/services/cacheService.js';

jest.mock('ioredis', () => {
  const create = () => {
    const { EventEmitter } = require('node:events');
    return Object.assign(new EventEmitter(), {
      status: 'connecting',
      defineCommand: jest.fn(),
      ping: jest.fn().mockResolvedValue('PONG'),
      info: jest.fn().mockResolvedValue('used_memory:1'),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
    });
  };
  const Mock = jest.fn(create);
  Mock.Cluster = jest.fn(create);
  return { __esModule: true, default: Mock };
});

const originalEnv = process.env;
let service;
beforeEach(() => {
  process.env = { NODE_ENV: 'test' };
  jest.clearAllMocks();
  service = new RedisService();
});
afterEach(async () => {
  await service.close();
  await redisService.close();
  redisService.localCache.clear();
  jest.useRealTimers();
  process.env = originalEnv;
});

function ready(svc = service) {
  svc.client.status = 'ready';
  svc.client.emit('ready');
}

describe('validated Redis configuration', () => {
  test.each([
    { REDIS_URL: 'http://redis' },
    { REDIS_URL: 'redis://cache:99999' },
    { REDIS_URL: 'redis://cache/not-a-db' },
    { REDIS_URL: 'redis://cache/1?db=2' },
    { REDIS_TLS: 'yes' },
    { REDIS_CLUSTER_NODES: 'redis:abc' },
    { REDIS_CLUSTER_NODES: '[::::]:6379' },
    { REDIS_CLUSTER_NODES: 'redis:0' },
    { REDIS_CLUSTER_NODES: 'redis:6379,' },
    { REDIS_SENTINEL_NODES: 'sentinel:26379' },
    { REDIS_CLUSTER_NODES: 'redis', REDIS_SENTINEL_NODES: 'sentinel' },
    { REDIS_CLUSTER_NODES: 'redis', REDIS_URL: 'redis://redis/1' },
  ])('rejects malformed or conflicting settings: %j', (env) => {
    expect(() => redisConfig(env)).toThrow();
  });
  test('redacts invalid URL diagnostics', () => {
    expect(() =>
      redisConfig({ REDIS_URL: 'http://user:private@redis' })
    ).toThrow('REDIS_URL must be');
    try {
      redisConfig({ REDIS_URL: 'http://user:private@redis' });
    } catch (err) {
      expect(err.message).not.toContain('private');
    }
  });
  test('uses TLS and URL credentials for cluster nodes, including IPv6', () => {
    process.env.REDIS_URL = 'rediss://worker:p%40ss@cache/0';
    process.env.REDIS_CLUSTER_NODES = 'cache:6380,[::1]:6381';
    service.init();
    expect(Redis.Cluster).toHaveBeenCalledWith(
      [
        { host: 'cache', port: 6380 },
        { host: '::1', port: 6381 },
      ],
      expect.objectContaining({
        redisOptions: expect.objectContaining({
          username: 'worker',
          password: 'p@ss',
          db: 0,
          tls: { rejectUnauthorized: true },
          enableOfflineQueue: false,
        }),
      })
    );
  });
  test('supports Sentinel-only production configuration and independent backoff', () => {
    Object.assign(process.env, {
      NODE_ENV: 'production',
      REDIS_SENTINEL_NODES: 's1:26379,s2:26380',
      REDIS_SENTINEL_NAME: 'primary',
      REDIS_SENTINEL_PASSWORD: 'sentinel-password',
    });
    service.init();
    const options = Redis.mock.calls[0][0];
    expect(options).toMatchObject({
      name: 'primary',
      role: 'master',
      sentinels: [
        { host: 's1', port: 26379 },
        { host: 's2', port: 26380 },
      ],
      sentinelPassword: 'sentinel-password',
    });
    expect(options.sentinelRetryStrategy(100)).toBeGreaterThanOrEqual(15000);
  });
  test('does not default to localhost in production without configuration', () => {
    process.env.NODE_ENV = 'production';
    service.init();
    expect(Redis).not.toHaveBeenCalled();
    expect(service.isFallbackMode).toBe(true);
  });
  test('retries exponentially and retains jitter at the cap', () => {
    expect(reconnectDelay(1, () => 0)).toBe(500);
    expect(reconnectDelay(2, () => 0)).toBe(1000);
    expect(reconnectDelay(100, () => 0)).toBe(15000);
    expect(reconnectDelay(100, () => 0.5)).toBe(22500);
  });
});

describe('shared lifecycle and recovery', () => {
  test('invalid configuration falls back without creating a socket', async () => {
    process.env.REDIS_URL = 'http://user:private@cache';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      service.init();
      expect(Redis).not.toHaveBeenCalled();
      expect(service.isFallbackMode).toBe(true);
      await service.set('key', 'local');
      expect(await service.get('key')).toBe('local');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private');
    } finally {
      log.mockRestore();
    }
  });
  test('Cluster-only configuration works in production and keeps discovery retrying', () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_CLUSTER_NODES = 'node1:6379,node2:6379';
    service.init();
    expect(Redis.Cluster).toHaveBeenCalledTimes(1);
    const retry = Redis.Cluster.mock.calls[0][1].clusterRetryStrategy;
    expect(retry(20)).toBeGreaterThan(0);
    expect(service.circuitBreakerState).toBe('OPEN');
  });
  test('reuses a subscriber while its connection is still being established', () => {
    service.init();
    ready();
    const subscriber = new (require('node:events').EventEmitter)();
    subscriber.status = 'connecting';
    subscriber.disconnect = jest.fn();
    service.client.duplicate = jest.fn(() => subscriber);
    expect(service._getRedisSubscriber()).toBe(subscriber);
    expect(service._getRedisSubscriber()).toBe(subscriber);
    expect(service.client.duplicate).toHaveBeenCalledTimes(1);
  });
  test('initializes only once and waits for ready, not connect', () => {
    service.init();
    service.init();
    expect(Redis).toHaveBeenCalledTimes(1);
    service.client.emit('connect');
    expect(service.isFallbackMode).toBe(true);
    ready();
    expect(service.isConnected).toBe(true);
    expect(service.client.defineCommand).toHaveBeenCalled();
  });
  test('continues retrying after ten failures and clears stale breaker timers on ready', async () => {
    jest.useFakeTimers();
    service.init();
    const retry = Redis.mock.calls[0][1].retryStrategy;
    expect(retry(11)).toBeGreaterThan(0);
    expect(service.circuitBreakerState).toBe('OPEN');
    ready();
    await jest.advanceTimersByTimeAsync(60000);
    expect(service.circuitBreakerState).toBe('CLOSED');
    expect(service.isFallbackMode).toBe(false);
  });
  test('probes a ready socket after command failures without requiring a reconnect event', async () => {
    jest.useFakeTimers();
    service.init();
    ready();
    service.client.get.mockRejectedValue(new Error('command timeout'));
    for (let i = 0; i < 5; i++) await service.get('missing');
    expect(service.circuitBreakerState).toBe('OPEN');
    await jest.advanceTimersByTimeAsync(60000);
    expect(service.client.ping).toHaveBeenCalled();
    expect(service.circuitBreakerState).toBe('CLOSED');
  });
  test('health reports degradation when a live ping fails', async () => {
    service.init();
    ready();
    service.client.ping.mockRejectedValue(new Error('socket failed'));
    expect(await service.healthCheck()).toMatchObject({
      status: 'fallback',
      circuitBreaker: 'OPEN',
    });
    expect(service.isFallbackMode).toBe(true);
  });
  test('close releases subscriber and main client and permits reinitialization', async () => {
    service.init();
    ready();
    const client = service.client;
    service.redisSubscriber = { status: 'reconnecting', disconnect: jest.fn() };
    const subscriber = service.redisSubscriber;
    service.openCircuitBreaker();
    await service.close();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
    expect(service.circuitBreakerTimer).toBeNull();
    service.init();
    expect(Redis).toHaveBeenCalledTimes(2);
  });
});

describe('legacy JSON cache delegates to the shared LRU', () => {
  test.each([{ nested: ['value'] }, false, 0, '', null])(
    'round trips %j during an outage',
    async (value) => {
      redisService.isFallbackMode = true;
      expect(await cacheService.set('json', value)).toBe(true);
      expect(await cacheService.get('json')).toEqual(value);
      expect(await cacheService.has('json')).toBe(true);
      await cacheService.del('json');
      expect(await cacheService.get('json')).toBeNull();
    }
  );
  test('honors TTL and bounded LRU eviction', async () => {
    redisService.isFallbackMode = true;
    await cacheService.set('short', { ok: true }, 0.01);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await cacheService.get('short')).toBeNull();
    for (let i = 0; i < 5001; i++) await cacheService.set(`entry:${i}`, i);
    expect(redisService.localCache.size).toBe(5000);
    expect(await cacheService.get('entry:0')).toBeNull();
  });
  test('caches search results and invalidates them while Redis is unavailable', async () => {
    redisService.isFallbackMode = true;
    const results = { items: ['contract'] };
    await cacheService.cacheSearchResults('token', {}, {}, results);
    const key = cacheService.generateSearchKey('token', {}, {});
    expect(await cacheService.get(key)).toEqual(results);
    expect(await cacheService.getPopularSearches()).toEqual([
      { query: 'token', count: 1 },
    ]);
    await cacheService.clearSearchCache();
    expect(await cacheService.get(key)).toBeNull();
  });
  test('reads live connection state and shares health checks', async () => {
    redisService.init();
    ready(redisService);
    expect(cacheService.redis).toBe(redisService.client);
    expect(await cacheService.healthCheck()).toMatchObject({
      status: 'connected',
    });
    redisService.client.emit('close');
    expect(cacheService.isConnected).toBe(false);
    expect(await cacheService.healthCheck()).toMatchObject({
      status: 'fallback',
    });
  });
});
