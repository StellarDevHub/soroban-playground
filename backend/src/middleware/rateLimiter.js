import LRU from 'lru-cache';
import redisService from '../services/redisService.js';

const memoryCache = new LRU({
  max: 1000,
  maxAge: 1000 * 60 * 15, // 15 minutes
});

// Default limits
const defaultLimits = {
  global: { window: 3600, max: 1000 },
  compile: { window: 3600, max: 10 },
  invoke: { window: 3600, max: 50 },
  deploy: { window: 3600, max: 5 },
};

export const rateLimitMiddleware = (endpoint = 'global') => {
  return async (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const key = `ratelimit:${endpoint}:${ip}`;
    
    // Try to get dynamic config from Redis
    let limit = defaultLimits[endpoint]?.max || 100;
    let window = defaultLimits[endpoint]?.window || 3600;

    if (!redisService.isFallbackMode && redisService.client) {
      try {
        const config = await redisService.client.hgetall('config:rate_limits');
        if (config[endpoint]) {
          limit = parseInt(config[endpoint], 10);
        }
      } catch (err) {
        // Ignore and use defaults
      }
    }

    const { allowed, current, fallback } = await redisService.checkRateLimit(key, limit, window);

    if (fallback) {
      // Memory fallback
      const memoryKey = `mem:${key}`;
      const count = (memoryCache.get(memoryKey) || 0) + 1;
      memoryCache.set(memoryKey, count);
      
      if (count > limit) {
        await redisService.logAnalytics(endpoint, ip, 'blocked');
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded (fallback mode)',
        });
      }
    } else if (!allowed) {
      await redisService.logAnalytics(endpoint, ip, 'blocked');
      return res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded for ${endpoint}. Current limit: ${limit} per hour.`,
      });
    }

    await redisService.logAnalytics(endpoint, ip, 'allowed');
    next();
  };
};
