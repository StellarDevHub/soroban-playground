import Redis from 'ioredis';
import {
  TOKEN_BUCKET_LUA,
  tokenBucketStep,
} from '../src/services/tokenBucket.js';
import {
  getStrategy,
  TokenBucketStrategy,
} from '../src/services/rateLimitStrategies.js';
import redisService from '../src/services/redisService.js';

// Issue #1574 — distributed token bucket.

function run(capacity, windowMs, times) {
  let state;
  const results = [];
  for (const now of times) {
    const step = tokenBucketStep(state, capacity, windowMs, now);
    state = step.state;
    results.push(step.result);
  }
  return results;
}

describe('tokenBucketStep', () => {
  it('allows a burst up to capacity then blocks', () => {
    const results = run(3, 60_000, [0, 0, 0, 0]);
    expect(results.map((r) => r[0])).toEqual([1, 1, 1, 0]);
    expect(results[2][1]).toBe(3); // used
  });

  it('reports retry-after until the next token refills', () => {
    const [, , , blocked] = run(3, 60_000, [0, 0, 0, 0]);
    // 3 tokens / 60s => one token every 20s
    expect(blocked[2]).toBe(20);
  });

  it('refills continuously instead of resetting at window boundaries', () => {
    const results = run(3, 60_000, [0, 0, 0, 10_000, 20_000, 20_000]);
    expect(results.map((r) => r[0])).toEqual([1, 1, 1, 0, 1, 0]);
  });

  it('never refills above capacity', () => {
    const results = run(2, 1_000, [0, 1_000_000, 1_000_000, 1_000_000]);
    expect(results.map((r) => r[0])).toEqual([1, 1, 1, 0]);
  });

  it('tolerates clock going backwards', () => {
    const results = run(1, 1_000, [5_000, 4_000]);
    expect(results.map((r) => r[0])).toEqual([1, 0]);
  });
});

describe('TokenBucket strategy', () => {
  it('is selectable by name and namespaces its keys', async () => {
    const strategy = getStrategy('TokenBucket');
    expect(strategy).toBeInstanceOf(TokenBucketStrategy);
    const redisService = { checkRateLimit: jest.fn().mockResolvedValue({}) };
    await strategy.check(redisService, 'ratelimit:compile:ip:1.2.3.4', 5, 1000);
    expect(redisService.checkRateLimit).toHaveBeenCalledWith(
      'TokenBucket',
      'rl:tb:ratelimit:compile:ip:1.2.3.4',
      5,
      1000
    );
  });
});

describe('redisService in-memory fallback', () => {
  let previousMode;
  beforeAll(() => {
    previousMode = redisService.isFallbackMode;
    redisService.isFallbackMode = true;
  });
  afterAll(() => {
    redisService.isFallbackMode = previousMode;
  });

  it('enforces the token bucket when Redis is unavailable', async () => {
    const key = `fallback-tb-${Date.now()}`;
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(
        await redisService.checkRateLimit('TokenBucket', key, 2, 60_000)
      );
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(results[2].retryAfter).toBe(30);
    expect(results[2].fallback).toBe(true);
  });

  it('keeps the legacy window strategies working', async () => {
    const key = `fallback-swc-${Date.now()}`;
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(
        await redisService.checkRateLimit(
          'SlidingWindowCounter',
          key,
          2,
          60_000
        )
      );
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
  });
});

// Runs against a real Redis when RATE_LIMIT_TEST_REDIS_URL is set (CI sets it
// via a redis:7-alpine service container).
const redisUrl = process.env.RATE_LIMIT_TEST_REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('TOKEN_BUCKET_LUA against Redis', () => {
  let client;
  const key = `test:tb:${process.pid}:${Date.now()}`;

  beforeAll(() => {
    client = new Redis(redisUrl, { lazyConnect: false });
    client.defineCommand('tokenBucket', {
      numberOfKeys: 1,
      lua: TOKEN_BUCKET_LUA,
    });
  });

  afterAll(async () => {
    await client.del(key);
    await client.quit();
  });

  it('enforces capacity atomically across concurrent callers', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => client.tokenBucket(key, 5, 60_000, 1))
    );
    const allowed = results.filter(([ok]) => ok === 1).length;
    expect(allowed).toBe(5);
    const blocked = results.find(([ok]) => ok === 0);
    expect(blocked[2]).toBeGreaterThan(0);
  });

  it('sets an expiry so idle buckets are reclaimed', async () => {
    const ttl = await client.pttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120_000);
  });
});
