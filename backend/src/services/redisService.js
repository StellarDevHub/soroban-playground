import Redis from 'ioredis';
import dotenv from 'dotenv';
import { LRUCache } from 'lru-cache';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const FALLBACK_TO_MEMORY = true;
const ANALYTICS_TTL_SECONDS = 60 * 60 * 24 * 30;

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
    this.maxAttempts = 3;
    this.localCache = new LRUCache({
      max: 5000, // Prevent memory leaks by capping the number of unique identifiers tracked
      ttl: 1000 * 60 * 60, // 1 hour TTL for fallback entries
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
      this.client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 5000,
        retryStrategy: (times) => {
          if (times > this.maxAttempts) {
            console.error('Redis connection failed, switching to fallback mode');
            this.isFallbackMode = true;
            return null;
          }
          return Math.min(times * 100, 2000);
        },
        connectionName: 'soroban-playground',
      });

      this.client.on('error', (err) => {
        console.error('Redis Error:', err.message);
        if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
          this.isFallbackMode = true;
        }
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis');
        this.isFallbackMode = false;
        this.defineScripts();
      });
    } catch (err) {
      console.error('Failed to initialize Redis:', err.message);
      this.isFallbackMode = true;
    }
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
    } catch (err) {
      console.error('Redis Rate Limit Error:', err.message);
      this.isFallbackMode = true;
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
    return await this.client.get(key);
  }

  async set(key, value, ttl) {
    if (this.isFallbackMode || !this.client) {
      this.localCache.set(key, value);
      return 'OK';
    }
    return await this.client.set(key, value, 'EX', ttl);
  }

  async delete(key) {
    if (this.isFallbackMode || !this.client) {
      this.localCache.delete?.(key);
      return 1;
    }
    return await this.client.del(key);
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
      const pipeline = this.client.pipeline();
      pipeline.hincrby(hourKey, safeStatus, 1);
      pipeline.hincrby(endpointKey, safeStatus, 1);
      pipeline.hincrby(ipKey, safeStatus, 1);
      pipeline.zincrby('analytics:top_ips', 1, safeIp);
      pipeline.expire(hourKey, ANALYTICS_TTL_SECONDS);
      pipeline.expire(endpointKey, ANALYTICS_TTL_SECONDS);
      pipeline.expire(ipKey, ANALYTICS_TTL_SECONDS);
      await pipeline.exec();
      return { stored: 'redis', hourKey, endpointKey, ipKey };
    } catch (err) {
      console.error('Failed to log analytics:', err.message);
      this.isFallbackMode = FALLBACK_TO_MEMORY;
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
}

// Export both default and named instance for compatibility
const redisService = new RedisService();
export default redisService;
export { redisService };
