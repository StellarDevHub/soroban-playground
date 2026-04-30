// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import redisService from '../services/redisService.js';
import { getStrategy } from '../services/rateLimitStrategies.js';
import { createHttpError } from '../middleware/errorHandler.js';
import apiKeyService from '../services/apiKeyService.js';

/**
 * Tiered Rate Limiter Middleware with API Key Support
 * Implements tiered quotas with persistent tracking and API key authentication
 */
export const tieredRateLimiter = (options = {}) => {
  const {
    strategyName = 'SlidingWindowCounter',
    identifier = 'apiKey', // 'apiKey', 'ip', or 'endpoint'
    fallbackTier = 'free'
  } = options;

  const strategy = getStrategy(strategyName);

  return async (req, res, next) => {
    try {
      let apiKeyData = null;
      let tier = fallbackTier;
      let limits = { requestsPerMinute: 10, requestsPerHour: 100, requestsPerDay: 1000, burstLimit: 20 };

      // Extract and validate API key
      const apiKey = req.headers['x-api-key'] || req.query.api_key;

      if (apiKey) {
        apiKeyData = await apiKeyService.validateKey(apiKey);
        if (apiKeyData) {
          tier = apiKeyData.tier;
          limits = apiKeyData.limits;
        }
      }

      // Determine identifier for rate limiting
      let id;
      if (identifier === 'apiKey' && apiKeyData) {
        id = `apikey:${apiKeyData.id}`;
      } else if (identifier === 'endpoint') {
        id = `${req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress}:${req.originalUrl}`;
      } else {
        id = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      }

      // Check rate limits for different windows
      const windows = [
        { name: 'minute', limit: limits.requestsPerMinute, windowMs: 60 * 1000 },
        { name: 'hour', limit: limits.requestsPerHour, windowMs: 60 * 60 * 1000 },
        { name: 'day', limit: limits.requestsPerDay, windowMs: 24 * 60 * 60 * 1000 }
      ];

      let minRemaining = Infinity;
      let retryAfter = 0;
      let exceeded = false;

      for (const window of windows) {
        const key = `ratelimit:${tier}:${window.name}:${id}`;
        const result = await strategy.check(redisService, key, window.limit, window.windowMs);

        minRemaining = Math.min(minRemaining, Math.max(0, window.limit - result.current));

        if (!result.allowed) {
          exceeded = true;
          retryAfter = Math.max(retryAfter, result.retryAfter || Math.ceil(window.windowMs / 1000));
        }
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit-Minute': limits.requestsPerMinute,
        'X-RateLimit-Remaining-Minute': Math.max(0, limits.requestsPerMinute - (await getCurrentCount(id, tier, 'minute', limits.requestsPerMinute, 60 * 1000))),
        'X-RateLimit-Limit-Hour': limits.requestsPerHour,
        'X-RateLimit-Remaining-Hour': Math.max(0, limits.requestsPerHour - (await getCurrentCount(id, tier, 'hour', limits.requestsPerHour, 60 * 60 * 1000))),
        'X-RateLimit-Limit-Day': limits.requestsPerDay,
        'X-RateLimit-Remaining-Day': Math.max(0, limits.requestsPerDay - (await getCurrentCount(id, tier, 'day', limits.requestsPerDay, 24 * 60 * 60 * 1000))),
        'X-RateLimit-Tier': tier,
        'X-RateLimit-Reset': Math.ceil(Date.now() / 1000) + 60 // Reset in 1 minute minimum
      });

      if (exceeded) {
        res.set('Retry-After', String(retryAfter));

        // Log rate limit violation
        if (apiKeyData) {
          await apiKeyService.logAudit({
            action: 'rate_limit_exceeded',
            apiKeyId: apiKeyData.id,
            userId: apiKeyData.userId,
            endpoint: req.originalUrl,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            statusCode: 429,
            metadata: { tier, limits }
          });
        }

        return next(createHttpError(429, 'Too Many Requests', {
          retryAfter,
          tier,
          limits
        }));
      }

      // Track usage if API key is present
      if (apiKeyData) {
        await apiKeyService.trackUsage(apiKeyData.id, req.originalUrl, tier);

        // Log successful request
        await apiKeyService.logAudit({
          action: 'request',
          apiKeyId: apiKeyData.id,
          userId: apiKeyData.userId,
          endpoint: req.originalUrl,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          statusCode: 200,
          metadata: { tier }
        });
      }

      next();
    } catch (err) {
      console.error('Tiered Rate Limiter Error:', err);
      // Fail open to maintain availability
      res.set({
        'X-RateLimit-Tier': fallbackTier,
        'X-RateLimit-Limit-Minute': 10
      });
      next();
    }
  };
};

/**
 * Helper function to get current count for a window
 */
async function getCurrentCount(id, tier, windowName, limit, windowMs) {
  try {
    const key = `ratelimit:${tier}:${windowName}:${id}`;
    const strategy = getStrategy('SlidingWindowCounter');
    const result = await strategy.check(redisService, key, limit, windowMs);
    return result.current;
  } catch (err) {
    return 0;
  }
}

export default tieredRateLimiter;