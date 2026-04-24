import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const FALLBACK_TO_MEMORY = true;

class RedisService {
  constructor() {
    this.client = null;
    this.isFallbackMode = false;
    this.connectionAttempts = 0;
    this.maxAttempts = 3;
    
    if (process.env.NODE_ENV !== 'test') {
      this.init();
    }
  }

  init() {
    try {
      this.client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 1,
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
        this.isFallbackMode = true;
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis');
        this.isFallbackMode = false;
      });
    } catch (err) {
      console.error('Failed to initialize Redis:', err.message);
      this.isFallbackMode = true;
    }
  }

  /**
   * Sliding window rate limiter using Lua script for atomicity
   */
  async checkRateLimit(key, limit, windowSeconds) {
    if (this.isFallbackMode || !this.client) {
      return { allowed: true, current: 0, fallback: true };
    }

    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;

    const luaScript = `
      local key = KEYS[1]
      local now = tonumber(ARGV[1])
      local windowStart = tonumber(ARGV[2])
      local limit = tonumber(ARGV[3])

      -- Remove old entries
      redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)
      
      -- Count remaining entries
      local count = redis.call('ZCARD', key)
      
      if count < limit then
        -- Add current request
        redis.call('ZADD', key, now, now)
        redis.call('EXPIRE', key, math.ceil(ARGV[3] / 1000) + 60)
        return {1, count + 1}
      else
        return {0, count}
      end
    `;

    try {
      const [allowed, current] = await this.client.eval(luaScript, 1, key, now, windowStart, limit);
      return { allowed: allowed === 1, current };
    } catch (err) {
      console.error('Redis Lua Error:', err.message);
      this.isFallbackMode = true;
      return { allowed: true, current: 0, fallback: true };
    }
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
