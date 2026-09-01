// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import redisService from '../services/redisService.js';
import { getStrategy } from '../services/rateLimitStrategies.js';
import { createHttpError } from './errorHandler.js';
import config from '../config/index.js';

/**
 * Production-grade Rate Limiter Middleware
 * @param {Object} options
 * @param {number|function} options.limit - Max requests in window, or a request-aware limit function
 * @param {number} options.windowMs - Window size in milliseconds
 * @param {string} options.strategyName - Strategy name (FixedWindow, SlidingWindowLog, SlidingWindowCounter)
 * @param {string} options.identifier - 'ip', 'apiKey', or 'endpoint'
 */
export const rateLimiter = (options = {}) => {
  const {
    limit = 100,
    windowMs = 60 * 1000,
    strategyName = 'SlidingWindowCounter',
    identifier = 'apiKeyOrIp',
  } = options;

  const strategy = getStrategy(strategyName);

  return async (req, res, next) => {
    let id;
    if (identifier === 'apiKey') {
      id =
        req.headers['x-api-key'] || req.user?.apiKey || req.user?.id || req.ip;
    } else if (identifier === 'endpoint') {
      id = `${req.ip}:${req.originalUrl}`;
    } else if (identifier === 'apiKeyOrIp') {
      id =
        req.headers['x-api-key'] ||
        req.user?.apiKey ||
        req.user?.id ||
        req.ip ||
        req.headers['x-forwarded-for'] ||
        req.socket?.remoteAddress;
    } else {
      id =
        req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress;
    }

    const key = `ratelimit:${strategy.getName()}:${id}`;

    try {
      const start = performance.now();
      const requestLimit = typeof limit === 'function' ? limit(req) : limit;
      const result = await strategy.check(redisService, key, requestLimit, windowMs);
      const duration = performance.now() - start;

      // Observability: Log if check exceeds performance threshold
      if (duration > 10) {
        console.warn(`Rate limiter took ${duration.toFixed(2)}ms for ${key}`);
      }

      const retryAfterSec = result.retryAfter || Math.ceil(windowMs / 1000);
      const resetTimestamp = Math.ceil(
        (Date.now() + retryAfterSec * 1000) / 1000
      );

      res.set({
        'X-RateLimit-Limit': requestLimit,
        'X-RateLimit-Remaining': Math.max(0, requestLimit - (result.current || 0)),
        'X-RateLimit-Reset': String(resetTimestamp),
      });

      if (!result.allowed) {
        res.set('Retry-After', String(retryAfterSec));

        await redisService.logAnalytics(req.originalUrl, id, 'blocked');

        return next(
          createHttpError(429, 'Too Many Requests', {
            retryAfter: retryAfterSec,
            reset: resetTimestamp,
          })
        );
      }

      await redisService.logAnalytics(req.originalUrl, id, 'allowed');
      next();
    } catch (err) {
      console.error('Rate Limiter Middleware Error:', err);
      next(); // Fail open to maintain availability during service failure
    }
  };
};

/**
 * Factory function to create rate limit middleware with config
 * @param {string} configKey - Key from config.rateLimit (e.g., 'global', 'compile', 'deploy')
 * @param {Object} options - Override options
 * @returns {Function} Express middleware function
 */
export const rateLimitMiddleware = (configKey, options = {}) => {
  const defaultRateLimitConfig =
    config.rateLimit[configKey] || config.rateLimit['global'];

  if (!defaultRateLimitConfig) {
    throw new Error(
      `Rate limit config not found for key: ${configKey} and fallback 'global' also not found`
    );
  }

  return (req, res, next) => {
    let rateLimitConfig = defaultRateLimitConfig;
    if (configKey === 'global') {
      const isAuthenticated = Boolean(
        req.user || req.headers['x-api-key'] || req.headers['authorization']
      );
      if (isAuthenticated && config.rateLimit.authenticated) {
        rateLimitConfig = config.rateLimit.authenticated;
      }
    }

    const limiter = rateLimiter({
      limit:
        options.limit ??
        (configKey === 'compile' || configKey === 'deploy'
          ? 15
          : rateLimitConfig.max),
      windowMs: options.windowMs ?? rateLimitConfig.windowMs,
      strategyName: options.strategyName || 'SlidingWindowCounter',
      identifier: options.identifier || 'apiKeyOrIp',
    });

    return limiter(req, res, next);
  };
};
