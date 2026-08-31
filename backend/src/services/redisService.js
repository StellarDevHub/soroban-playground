import Redis from 'ioredis';
import dotenv from 'dotenv';
import { LRUCache } from 'lru-cache';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_TLS = process.env.REDIS_TLS === 'true';
const REDIS_CLUSTER_NODES = process.env.REDIS_CLUSTER_NODES
  ? process.env.REDIS_CLUSTER_NODES.split(',')
  : null;
const FALLBACK_TO_MEMORY = true;
const ANALYTICS_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_TTL_SECONDS = 300;
const POPULARITY_TTL_SECONDS = 86400 * 7;
const MAX_SMART_TTL_SECONDS = 1800;
const BASE_SMART_TTL_SECONDS = 300;
const SMART_TTL_POPULARITY_STEP_SECONDS = 60;

// Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_TIMEOUT_MS = 60000;
const CIRCUIT_BREAKER_HALF_OPEN_ATTEMPTS = 3;

function padDatePart(value) {
  return String(value).padStart(2, '0');
}

export function getAnalyticsHourKey(date = new Date()) {
  return [
    'analytics:hr',
    `${date.getUTCFullYear()}-${padDatePart(date.getUTCMonth() + 1)}-${padDatePart(date.getUTCDate())}`,
    padDatePart(date.getUTCHours()),
  ].join(':');
}

function normalizeAnalyticsValue(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 300) : fallback;
}

function incrementCounter(map, key, status) {
  const entry = map.get(key) || {};
  entry[status] = (entry[status] || 0) + 1;
  map.set(key, entry);
}

class RedisService {
  constructor() {
    this.client = null;
    this.isFallbackMode = false;
    this.connectionAttempts = 0;
    this.maxAttempts = 10;
    this.reconnectBackoffMs = 1000;
    this.circuitBreakerState = 'CLOSED';
    this.circuitBreakerFailures = 0;
    this.circuitBreakerLastFailTime = null;
    this.circuitBreakerHalfOpenAttempts = 0;
    this.localCache = new LRUCache({
      max: 5000,
      maxSize: 100 * 1024 * 1024, // 100MB memory limit
      sizeCalculation: (value) => JSON.stringify(value).length,
      ttl: 1000 * 60 * 60,
    });
    this.localAnalytics = {
      hourly: new Map(),
      endpoints: new Map(),
      ips: new Map(),
    };

    if (process.env.NODE_ENV !== 'test') {
      this.init();
    }
  }

  init() {
    try {
      if (!process.env.REDIS_URL && process.env.NODE_ENV === 'production') {
        console.log(
          'No REDIS_URL provided in production, switching to fallback mode'
        );
        this.isFallbackMode = true;
        return;
      }

      this.client = this._buildClient(REDIS_URL);
    } catch (err) {
      console.error('Failed to initialize Redis:', err.message || err);
      this.isFallbackMode = true;
    }
  }

  _buildClient(url) {
    const baseOptions = {
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
      commandTimeout: 3000,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: false,
      connectionName: 'soroban-playground',
      retryStrategy: (times) => {
        if (times > this.maxAttempts) {
          console.error(
            `Redis max retry attempts (${this.maxAttempts}) exceeded, engaging circuit breaker`
          );
          this.openCircuitBreaker();
          return null;
        }
        const jitter = Math.random() * 1000;
        const delay = Math.min(
          this.reconnectBackoffMs * Math.pow(2, times - 1) + jitter,
          30000
        );
        console.log(`Redis reconnection attempt ${times}, retrying in ${Math.round(delay)}ms`);
        return delay;
      },
    };

    if (REDIS_TLS) {
      baseOptions.tls = {
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== 'false',
      };
    }

    let client;
    if (REDIS_CLUSTER_NODES && REDIS_CLUSTER_NODES.length > 0) {
      const clusterNodes = REDIS_CLUSTER_NODES.map((node) => {
        const [host, port] = node.split(':');
        return { host, port: parseInt(port || '6379', 10) };
      });
      client = new Redis.Cluster(clusterNodes, {
        redisOptions: baseOptions,
        clusterRetryStrategy: baseOptions.retryStrategy,
      });
      console.log('Initializing Redis Cluster with nodes:', clusterNodes);
    } else {
      client = new Redis(url, baseOptions);
    }

    client.on('error', (err) => {
      if (!this.isFallbackMode) {
        if (err.code !== 'ECONNREFUSED' && err.code !== 'ETIMEDOUT') {
          console.error('Redis Error:', err.message || err);
        }
      }
      this.recordCircuitBreakerFailure();
      if (
        err.code === 'ECONNREFUSED' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ENOTFOUND'
      ) {
        this.isFallbackMode = true;
      }
    });

    client.on('connect', () => {
      console.log('Connected to Redis');
      this.resetCircuitBreaker();
      this.isFallbackMode = false;
      this.connectionAttempts = 0;
      this.defineScripts();
    });

    client.on('ready', () => {
      console.log('Redis client ready');
      this.resetCircuitBreaker();
    });

    client.on('reconnecting', (delay) => {
      console.log(`Redis reconnecting in ${delay}ms`);
    });

    client.on('close', () => {
      console.warn('Redis connection closed');
    });

    return client;
  }

  recordCircuitBreakerFailure() {
    this.circuitBreakerFailures++;
    this.circuitBreakerLastFailTime = Date.now();
    if (this.circuitBreakerFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.openCircuitBreaker();
    }
  }

  openCircuitBreaker() {
    if (this.circuitBreakerState !== 'OPEN') {
      console.warn(
        `Circuit breaker OPEN after ${this.circuitBreakerFailures} failures. Falling back to LRU memory cache.`
      );
      this.circuitBreakerState = 'OPEN';
      this.isFallbackMode = true;
      setTimeout(() => {
        this.circuitBreakerState = 'HALF_OPEN';
        this.circuitBreakerHalfOpenAttempts = 0;
        console.log('Circuit breaker entering HALF_OPEN state, testing connection...');
      }, CIRCUIT_BREAKER_TIMEOUT_MS);
    }
  }

  resetCircuitBreaker() {
    if (this.circuitBreakerState !== 'CLOSED') {
      console.log('Circuit breaker CLOSED, Redis connection restored');
    }
    this.circuitBreakerState = 'CLOSED';
    this.circuitBreakerFailures = 0;
    this.circuitBreakerHalfOpenAttempts = 0;
    this.isFallbackMode = false;
  }

  async executeWithCircuitBreaker(fn) {
    if (this.circuitBreakerState === 'OPEN') {
      throw new Error('Circuit breaker is OPEN, using fallback');
    }

    if (this.circuitBreakerState === 'HALF_OPEN') {
      this.circuitBreakerHalfOpenAttempts++;
      if (this.circuitBreakerHalfOpenAttempts > CIRCUIT_BREAKER_HALF_OPEN_ATTEMPTS) {
        this.openCircuitBreaker();
        throw new Error('Circuit breaker half-open test failed, reopening');
      }
    }

    try {
      const result = await fn();
      if (this.circuitBreakerState === 'HALF_OPEN') {
        this.resetCircuitBreaker();
      }
      return result;
    } catch (err) {
      this.recordCircuitBreakerFailure();
      throw err;
    }
  }

  /**
   * Reconnects Redis with a new URL without a restart (for credential
   * rotation). Connects the new client, swaps it in, then gracefully quits the
   * old one so its in-flight commands complete.
   */
  async rotateConnection(url) {
    const next = this._buildClient(url);
    const previous = this.client;
    this.client = next;
    this.isFallbackMode = false;

    if (previous && previous !== next) {
      try {
        await previous.quit();
      } catch {
        try {
          previous.disconnect();
        } catch {
          // already gone
        }
      }
    }
    return next;
  }

  defineScripts() {
    this.client.defineCommand('slidingWindowLog', {
      numberOfKeys: 1,
      lua: `
        local key = KEYS[1]
        local limit = tonumber(ARGV[1])
        local window_ms = tonumber(ARGV[2])
        local now_ms = tonumber(ARGV[3])
        local window_start = now_ms - window_ms
        redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
        local count = redis.call('ZCARD', key)
        if count < limit then
          redis.call('ZADD', key, now_ms, now_ms)
          redis.call('PEXPIRE', key, window_ms)
          return {1, count + 1, 0}
        else
          local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
          local retry_after = 0
          if #oldest > 0 then
            retry_after = math.ceil((tonumber(oldest[2]) + window_ms - now_ms) / 1000)
          end
          return {0, count, retry_after}
        end
      `,
    });

    this.client.defineCommand('slidingWindowCounter', {
      numberOfKeys: 2,
      lua: `
        local current_key = KEYS[1]
        local previous_key = KEYS[2]
        local limit = tonumber(ARGV[1])
        local window_ms = tonumber(ARGV[2])
        local now_ms = tonumber(ARGV[3])
        local current_count = redis.call('INCR', current_key)
        if current_count == 1 then
          redis.call('PEXPIRE', current_key, window_ms * 2)
        end
        local previous_count = tonumber(redis.call('GET', previous_key) or 0)
        local window_progress = (now_ms % window_ms) / window_ms
        local count = current_count + (previous_count * (1 - window_progress))
        if count > limit then
          return {0, math.ceil(count), math.ceil(window_ms / 1000)}
        end
        return {1, math.ceil(count), 0}
      `,
    });

    this.client.defineCommand('fixedWindow', {
      numberOfKeys: 1,
      lua: `
        local key = KEYS[1]
        local limit = tonumber(ARGV[1])
        local window_s = tonumber(ARGV[2])
        local count = redis.call('INCR', key)
        if count == 1 then
          redis.call('EXPIRE', key, window_s)
        end
        if count > limit then
          return {0, count, redis.call('TTL', key)}
        end
        return {1, count, 0}
      `,
    });
  }

  async checkRateLimit(strategy, key, limit, windowMs) {
    if (this.isFallbackMode || !this.client) {
      return this.checkMemoryRateLimit(key, limit, windowMs);
    }

    const now = Date.now();
    try {
      return await this.executeWithCircuitBreaker(async () => {
        let result;
        if (strategy === 'SlidingWindowLog') {
          result = await this.client.slidingWindowLog(key, limit, windowMs, now);
        } else if (strategy === 'SlidingWindowCounter') {
          const windowIdx = Math.floor(now / windowMs);
          const currentKey = `${key}:${windowIdx}`;
          const previousKey = `${key}:${windowIdx - 1}`;
          result = await this.client.slidingWindowCounter(
            currentKey,
            previousKey,
            limit,
            windowMs,
            now
          );
        } else {
          result = await this.client.fixedWindow(
            key,
            limit,
            Math.ceil(windowMs / 1000)
          );
        }

        const [allowed, current, retryAfter] = result;
        return { allowed: allowed === 1, current, retryAfter };
      });
    } catch (err) {
      console.error('Redis Rate Limit Error:', err.message);
      return this.checkMemoryRateLimit(key, limit, windowMs);
    }
  }

  checkMemoryRateLimit(key, limit, windowMs) {
    const now = Date.now();
    const bucket = this.localCache.get(key) || [];
    const windowStart = now - windowMs;

    // Filter out expired timestamps and enforce a hard cap to prevent array bloat
    const fresh = bucket.filter((ts) => ts > windowStart).slice(-limit);

    if (fresh.length < limit) {
      fresh.push(now);
      this.localCache.set(key, fresh);
      return { allowed: true, current: fresh.length, fallback: true };
    }

    const retryAfter = Math.ceil((fresh[0] + windowMs - now) / 1000) || 1;
    return {
      allowed: false,
      current: fresh.length,
      retryAfter,
      fallback: true,
    };
  }

  async get(key) {
    if (this.isFallbackMode || !this.client) {
      const val = this.localCache.get(key);
      return val !== undefined ? val : null;
    }
    try {
      return await this.executeWithCircuitBreaker(() => this.client.get(key));
    } catch (err) {
      const val = this.localCache.get(key);
      return val !== undefined ? val : null;
    }
  }

  async set(key, value, ttl = DEFAULT_TTL_SECONDS) {
    if (this.isFallbackMode || !this.client) {
      this.localCache.set(key, value, { ttl: ttl * 1000 });
      return 'OK';
    }
    try {
      return await this.executeWithCircuitBreaker(() =>
        this.client.set(key, value, 'EX', ttl)
      );
    } catch (err) {
      this.localCache.set(key, value, { ttl: ttl * 1000 });
      return 'OK';
    }
  }

  async setex(key, ttl, value) {
    return await this.set(key, value, ttl);
  }

  async setNX(key, value, ttlSeconds) {
    try {
      if (this.client && !this.isFallbackMode) {
        return await this.executeWithCircuitBreaker(() =>
          this.client.set(key, value, 'EX', ttlSeconds, 'NX')
        );
      }
    } catch (err) {
      console.warn('Redis setNX error, using memory fallback:', err.message);
    }
    if (!this.localCache.has(key)) {
      this.localCache.set(key, value, { ttl: ttlSeconds * 1000 });
      return 'OK';
    }
    return null;
  }

  async delete(key) {
    if (this.isFallbackMode || !this.client) {
      this.localCache.delete?.(key);
      return 1;
    }
    try {
      return await this.executeWithCircuitBreaker(() => this.client.del(key));
    } catch (err) {
      this.localCache.delete?.(key);
      return 1;
    }
  }

  async del(key) {
    return await this.delete(key);
  }

  async has(key) {
    if (this.isFallbackMode || !this.client) {
      return this.localCache.has(key);
    }
    try {
      const exists = await this.executeWithCircuitBreaker(() =>
        this.client.exists(key)
      );
      return exists === 1;
    } catch (err) {
      return this.localCache.has(key);
    }
  }

  async exists(key) {
    return (await this.has(key)) ? 1 : 0;
  }

  async incr(key) {
    if (this.isFallbackMode || !this.client) {
      const current = this.localCache.get(key) || 0;
      const next = parseInt(current, 10) + 1;
      this.localCache.set(key, next);
      return next;
    }
    try {
      return await this.executeWithCircuitBreaker(() => this.client.incr(key));
    } catch (err) {
      const current = this.localCache.get(key) || 0;
      const next = parseInt(current, 10) + 1;
      this.localCache.set(key, next);
      return next;
    }
  }

  async expire(key, seconds) {
    if (this.isFallbackMode || !this.client) {
      return 1;
    }
    try {
      return await this.executeWithCircuitBreaker(() =>
        this.client.expire(key, seconds)
      );
    } catch (err) {
      return 1;
    }
  }

  async hincrby(key, field, increment) {
    if (this.isFallbackMode || !this.client) {
      const hash = this.localCache.get(key) || {};
      hash[field] = (parseInt(hash[field], 10) || 0) + increment;
      this.localCache.set(key, hash);
      return hash[field];
    }
    try {
      return await this.executeWithCircuitBreaker(() =>
        this.client.hincrby(key, field, increment)
      );
    } catch (err) {
      const hash = this.localCache.get(key) || {};
      hash[field] = (parseInt(hash[field], 10) || 0) + increment;
      this.localCache.set(key, hash);
      return hash[field];
    }
  }

  async zincrby(key, increment, member) {
    if (this.isFallbackMode || !this.client) {
      const zset = this.localCache.get(key) || new Map();
      zset.set(member, (zset.get(member) || 0) + increment);
      this.localCache.set(key, zset);
      return zset.get(member);
    }
    try {
      return await this.executeWithCircuitBreaker(() =>
        this.client.zincrby(key, increment, member)
      );
    } catch (err) {
      const zset = this.localCache.get(key) || new Map();
      zset.set(member, (zset.get(member) || 0) + increment);
      this.localCache.set(key, zset);
      return zset.get(member);
    }
  }

  async scan(cursor, ...args) {
    if (this.isFallbackMode || !this.client) {
      return ['0', []];
    }
    try {
      return await this.executeWithCircuitBreaker(() =>
        this.client.scan(cursor, ...args)
      );
    } catch (err) {
      return ['0', []];
    }
  }

  pipeline() {
    if (this.isFallbackMode || !this.client) {
      return {
        hincrby: () => this,
        zincrby: () => this,
        expire: () => this,
        exec: async () => [],
      };
    }
    return this.client.pipeline();
  }

  async ping() {
    if (this.isFallbackMode || !this.client) {
      return 'PONG';
    }
    try {
      return await this.executeWithCircuitBreaker(() => this.client.ping());
    } catch (err) {
      return 'PONG';
    }
  }

  async info(section) {
    if (this.isFallbackMode || !this.client) {
      return 'fallback_mode';
    }
    try {
      return await this.executeWithCircuitBreaker(() =>
        this.client.info(section)
      );
    } catch (err) {
      return 'fallback_mode';
    }
  }

  async dbsize() {
    if (this.isFallbackMode || !this.client) {
      return this.localCache.size;
    }
    try {
      return await this.executeWithCircuitBreaker(() => this.client.dbsize());
    } catch (err) {
      return this.localCache.size;
    }
  }

  async connect() {
    if (this.client && !this.client.status.includes('connect')) {
      await this.client.connect();
    }
  }

  async quit() {
    if (this.client) {
      await this.client.quit();
    }
  }

  async disconnect() {
    if (this.client) {
      this.client.disconnect();
    }
  }

  get status() {
    if (this.isFallbackMode) return 'fallback';
    if (!this.client) return 'disconnected';
    return this.client.status;
  }

  get isConnected() {
    return !this.isFallbackMode && this.client && this.client.status === 'ready';
  }

  /**
   * Log analytics data for endpoint usage.
   * @param {string} endpoint - The API endpoint being accessed.
   * @param {string} ip - IP address of the requester.
   * @param {string} status - Status label (e.g., 'success', 'error').
   */
  async logAnalytics(endpoint, ip, status) {
    const safeEndpoint = normalizeAnalyticsValue(endpoint, 'unknown');
    const safeIp = normalizeAnalyticsValue(ip, 'unknown');
    const safeStatus = normalizeAnalyticsValue(status, 'unknown');
    const hourKey = getAnalyticsHourKey();
    const endpointKey = `analytics:endpoint:${safeEndpoint}`;
    const ipKey = `analytics:ip:${safeIp}`;

    if (this.isFallbackMode || !this.client) {
      this.logMemoryAnalytics(hourKey, safeEndpoint, safeIp, safeStatus);
      return { stored: 'memory', hourKey, endpointKey, ipKey };
    }

    try {
      await this.executeWithCircuitBreaker(async () => {
        const pipeline = this.client.pipeline();
        pipeline.hincrby(hourKey, safeStatus, 1);
        pipeline.hincrby(endpointKey, safeStatus, 1);
        pipeline.hincrby(ipKey, safeStatus, 1);
        pipeline.zincrby('analytics:top_ips', 1, safeIp);
        pipeline.expire(hourKey, ANALYTICS_TTL_SECONDS);
        pipeline.expire(endpointKey, ANALYTICS_TTL_SECONDS);
        pipeline.expire(ipKey, ANALYTICS_TTL_SECONDS);
        await pipeline.exec();
      });
      return { stored: 'redis', hourKey, endpointKey, ipKey };
    } catch (err) {
      console.error('Failed to log analytics:', err.message);
      this.logMemoryAnalytics(hourKey, safeEndpoint, safeIp, safeStatus);
      return { stored: 'memory', hourKey, endpointKey, ipKey };
    }
  }

  logMemoryAnalytics(hourKey, endpoint, ip, status) {
    incrementCounter(this.localAnalytics.hourly, hourKey, status);
    incrementCounter(this.localAnalytics.endpoints, endpoint, status);
    incrementCounter(this.localAnalytics.ips, ip, status);
  }

  getMemoryAnalyticsSnapshot() {
    return {
      hourly: Object.fromEntries(this.localAnalytics.hourly),
      endpoints: Object.fromEntries(this.localAnalytics.endpoints),
      ips: Object.fromEntries(this.localAnalytics.ips),
    };
  }

  // ==================== CacheService Methods (Merged) ====================

  async #deleteByPattern(pattern) {
    if (!this.isConnected || !this.client) return 0;

    let cursor = '0';
    let deleted = 0;
    try {
      await this.executeWithCircuitBreaker(async () => {
        do {
          const [next, keys] = await this.client.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100
          );
          cursor = next;
          if (keys.length > 0) {
            await this.client.del(...keys);
            deleted += keys.length;
          }
        } while (cursor !== '0');
      });
    } catch (err) {
      console.error('deleteByPattern error:', err.message);
    }
    return deleted;
  }

  async #scanPattern(pattern) {
    const results = [];
    let cursor = '0';
    if (!this.isConnected || !this.client) return results;

    try {
      await this.executeWithCircuitBreaker(async () => {
        do {
          const [next, keys] = await this.client.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100
          );
          cursor = next;
          if (keys.length > 0) {
            const pipeline = this.client.pipeline();
            keys.forEach((key) => pipeline.get(key));
            const values = await pipeline.exec();
            values.forEach(([err, val], idx) => {
              if (!err && val) {
                results.push({ key: keys[idx], value: val });
              }
            });
          }
        } while (cursor !== '0');
      });
    } catch (err) {
      console.error('scanPattern error:', err.message);
    }
    return results;
  }

  generateSearchKey(query, filters, pagination) {
    const keyData = { query, filters, pagination };
    return `search:${Buffer.from(JSON.stringify(keyData)).toString('base64')}`;
  }

  generateFacetKey(query) {
    return `facets:${Buffer.from(query).toString('base64')}`;
  }

  generateAutocompleteKey(query) {
    return `autocomplete:${Buffer.from(query).toString('base64')}`;
  }

  async clearSearchCache() {
    if (!this.isConnected) return false;
    try {
      await this.#deleteByPattern('search:*');
      return true;
    } catch (error) {
      console.error('Cache clear error:', error);
      return false;
    }
  }

  async incrementSearchPopularity(query) {
    const key = `popular:${query}`;
    try {
      if (this.isConnected) {
        await this.executeWithCircuitBreaker(async () => {
          await this.client.incr(key);
          await this.client.expire(key, POPULARITY_TTL_SECONDS);
        });
        return true;
      }
    } catch (error) {
      console.error('Popularity increment error:', error);
    }
    return false;
  }

  async getPopularSearches(limit = 10) {
    if (!this.isConnected) return [];

    try {
      const entries = await this.#scanPattern('popular:*');
      const searches = entries.map(({ key, value }) => ({
        query: key.replace('popular:', ''),
        count: parseInt(value, 10),
      }));

      return searches.sort((a, b) => b.count - a.count).slice(0, limit);
    } catch (error) {
      console.error('Popular searches cache error:', error);
      return [];
    }
  }

  async cacheSearchResults(query, filters, pagination, results) {
    if (!this.isConnected) return false;

    try {
      const key = this.generateSearchKey(query, filters, pagination);
      const popularityScore = await this.getQueryPopularity(query);
      const ttl = Math.min(
        BASE_SMART_TTL_SECONDS +
          popularityScore * SMART_TTL_POPULARITY_STEP_SECONDS,
        MAX_SMART_TTL_SECONDS
      );

      await this.set(key, JSON.stringify(results), ttl);
      await this.incrementSearchPopularity(query);

      return true;
    } catch (error) {
      console.error('Search results caching error:', error);
      return false;
    }
  }

  async getQueryPopularity(query) {
    if (!this.isConnected) return 0;

    try {
      const key = `popular:${query}`;
      const count = await this.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      console.error('Query popularity error:', error);
      return 0;
    }
  }

  async healthCheck() {
    if (!this.isConnected) {
      return {
        status: this.isFallbackMode ? 'fallback' : 'disconnected',
        message: 'Redis not connected, using memory cache',
        circuitBreaker: this.circuitBreakerState,
      };
    }

    try {
      const pong = await this.ping();
      const info = await this.info('memory');

      return {
        status: 'connected',
        message: 'Redis is healthy',
        ping: pong,
        memory: info,
        circuitBreaker: this.circuitBreakerState,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
        circuitBreaker: this.circuitBreakerState,
      };
    }
  }

  async getCacheAdminSnapshot() {
    return {
      cacheVersion: 'v1',
      memoryEntries: this.isConnected ? await this.dbsize() : this.localCache.size,
      isConnected: this.isConnected,
      isFallbackMode: this.isFallbackMode,
      circuitBreakerState: this.circuitBreakerState,
      circuitBreakerFailures: this.circuitBreakerFailures,
    };
  }

  async warmCache({ hashes, top }) {
    return { warmed: hashes || [], warmedCount: (hashes || []).length };
  }

  async invalidateCache({ hash, dependency, namespace }) {
    if (hash) {
      await this.del(hash);
    }
    if (namespace) {
      await this.#deleteByPattern(`${namespace}:*`);
    }
    return { success: true };
  }

  async bumpCacheVersion({ version }) {
    return version || 'v2';
  }

  async close() {
    if (this.client) {
      await this.client.quit();
      this.isFallbackMode = true;
      this.isConnected = false;
    }
  }

  async initialize() {
    if (!this.client) {
      this.init();
    }
    if (this.client && !this.isConnected) {
      await this.connect();
    }
    return this.isConnected;
  }
}

// Export both default and named instance for compatibility
const redisService = new RedisService();
export default redisService;
export { redisService };
