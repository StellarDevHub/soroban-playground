// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import redisService from '../services/redisService.js';
import { getStrategy } from '../services/rateLimitStrategies.js';
import { createHttpError } from './errorHandler.js';

/**
 * Production-grade Rate Limiter Middleware
 * @param {Object} options 
 * @param {number} options.limit - Max requests in window
 * @param {number} options.windowMs - Window size in milliseconds
 * @param {string} options.strategyName - Strategy name (FixedWindow, SlidingWindowLog, SlidingWindowCounter)
 * @param {string} options.identifier - 'ip', 'apiKey', or 'endpoint'
 */
export const rateLimiter = (options = {}) => {
  const {
    limit = 100,
    windowMs = 60 * 1000,
    strategyName = 'SlidingWindowCounter',
    identifier = 'ip'
  } = options;

  const strategy = getStrategy(strategyName);

  return async (req, res, next) => {
    let id;
    if (identifier === 'apiKey') {
      id = req.headers['x-api-key'] || req.ip;
    } else if (identifier === 'endpoint') {
      id = `${req.ip}:${req.originalUrl}`;
    } else {
      id = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    }

    const key = `ratelimit:${strategy.getName()}:${id}`;

    try {
      const start = performance.now();
      const result = await strategy.check(redisService, key, limit, windowMs);
      const duration = performance.now() - start;

      // Observability: Log if check exceeds performance threshold
      if (duration > 10) {
        console.warn(`Rate limiter took ${duration.toFixed(2)}ms for ${key}`);
      }

      res.set({
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': Math.max(0, limit - result.current),
      });

      if (!result.allowed) {
        res.set('Retry-After', String(result.retryAfter || Math.ceil(windowMs / 1000)));
        
        await redisService.logAnalytics(req.originalUrl, id, 'blocked');
        
        return next(createHttpError(429, 'Too Many Requests', { 
          retryAfter: result.retryAfter 
        }));
      }

      await redisService.logAnalytics(req.originalUrl, id, 'allowed');
      next();
    } catch (err) {
      console.error('Rate Limiter Middleware Error:', err);
      next(); // Fail open to maintain availability during service failure
    }
  };
};

export const rateLimitMiddleware = (scope = 'global') => {
  const limits = {
    compile: { limit: 20, windowMs: 60 * 1000, identifier: 'ip' },
    deploy: { limit: 30, windowMs: 60 * 1000, identifier: 'ip' },
    invoke: { limit: 60, windowMs: 60 * 1000, identifier: 'ip' },
    global: { limit: 120, windowMs: 60 * 1000, identifier: 'ip' },
  };

  return rateLimiter(limits[scope] || limits.global);
};
