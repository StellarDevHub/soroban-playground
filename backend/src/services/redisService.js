import Redis from 'ioredis';
import dotenv from 'dotenv';
import { LRUCache } from 'lru-cache';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const FALLBACK_TO_MEMORY = true;

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
        result = await this.client.slidingWindowCounter(currentKey, previousKey, limit, windowMs, now);
      } else {
        result = await this.client.fixedWindow(key, limit, Math.ceil(windowMs / 1000));
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
    // Even if the limit is high, we don't store more than what is needed to verify the current window
    const fresh = bucket.filter(ts => ts > windowStart).slice(-limit);

    if (fresh.length < limit) {
      fresh.push(now);
      this.localCache.set(key, fresh);
      return { allowed: true, current: fresh.length, fallback: true };
    }
    
    const retryAfter = Math.ceil((fresh[0] + windowMs - now) / 1000) || 1;
    return { allowed: false, current: fresh.length, retryAfter, fallback: true };
  }

  async logAnalytics(endpoint, ip, status) {
    if (this.isFallbackMode || !this.client) return;

    const now = new Date();
    const hourKey = `analytics:hr:${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}:${now.getUTCHours()}`;
    const endpointKey = `analytics:endpoint:${endpoint}`;
    const ipKey = `analytics:ip:${ip}`;

    try {
      const pipeline = this.client.pipeline();
      pipeline.hincrby(hourKey, status, 1);
      pipeline.hincrby(endpointKey, status, 1);
      pipeline.zincrby('analytics:top_ips', 1, ip);
      pipeline.expire(hourKey, 60 * 60 * 24 * 30); // 30 days
      await pipeline.exec();
    } catch (err) {
      console.error('Failed to log analytics:', err.message);
    }
  }
}

const redisService = new RedisService();
export default redisService;
