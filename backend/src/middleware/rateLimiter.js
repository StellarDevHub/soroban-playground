// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import redisService from '../services/redisService.js';
import { getStrategy } from '../services/rateLimitStrategies.js';
import { createHttpError } from './errorHandler.js';
import { resolveClientIp } from './clientIp.js';
import config from '../config/index.js';

/**
 * Quota multipliers applied to a route's base limit, keyed by API key tier
 * (see tier_limits in schema.sql). Anonymous and unverified callers get 1x.
 */
export const TIER_MULTIPLIERS = Object.freeze({
  anonymous: 1,
  free: 1,
  standard: 5,
  premium: 20,
  admin: 100,
});

const MAX_API_KEY_LENGTH = 256;
const API_KEY_CACHE_TTL_MS = 60 * 1000;

// Caches validation results (including misses) by key hash so a flood of
// requests does not turn into a flood of api_keys lookups.
const apiKeyCache = new LRUCache({ max: 10_000, ttl: API_KEY_CACHE_TTL_MS });

async function defaultApiKeyValidator(key) {
  const { default: apiKeyService } =
    await import('../services/apiKeyService.js');
  return apiKeyService.validateKey(key);
}

async function lookupApiKey(rawKey, validateApiKey) {
  const cacheKey = crypto.createHash('sha256').update(rawKey).digest('hex');
  const cached = apiKeyCache.get(cacheKey);
  if (cached) return cached.data;

  let data = null;
  try {
    data = (await validateApiKey(rawKey)) || null;
  } catch (err) {
    // Treat lookup failures as unverified rather than failing the request;
    // do not cache so the key is re-checked once the store recovers.
    console.warn('[RateLimiter] API key validation failed:', err.message);
    return null;
  }
  apiKeyCache.set(cacheKey, { data });
  return data;
}

export function clearApiKeyCache() {
  apiKeyCache.clear();
}

/**
 * Work out who a request should be rate limited as.
 *
 * Only *verified* identities get their own bucket: a caller cannot mint fresh
 * quota by sending random X-API-Key values or spoofed X-Forwarded-For headers.
 * Unverified keys fall back to the caller's IP bucket with anonymous quotas.
 */
export async function resolveRateLimitIdentity(req, options = {}) {
  const validateApiKey = options.validateApiKey || defaultApiKeyValidator;
  const ip = req.clientIp || resolveClientIp(req);

  const rawKey = req.headers?.['x-api-key'];
  if (
    typeof rawKey === 'string' &&
    rawKey.length > 0 &&
    rawKey.length <= MAX_API_KEY_LENGTH
  ) {
    const keyData = await lookupApiKey(rawKey, validateApiKey);
    if (keyData?.id !== undefined && keyData?.id !== null) {
      return {
        id: `key:${keyData.id}`,
        tier: keyData.tier || 'free',
        verified: true,
        ip,
      };
    }
  }

  // req.user is only ever populated by our own auth middleware.
  if (req.user?.id !== undefined && req.user?.id !== null) {
    return {
      id: `user:${req.user.id}`,
      tier: req.user.tier || 'free',
      verified: true,
      ip,
    };
  }

  return { id: `ip:${ip}`, tier: 'anonymous', verified: false, ip };
}

function requestPath(req) {
  // Strip the query string so `?x=1`, `?x=2`, ... cannot mint new buckets.
  const url = req.originalUrl || req.url || '';
  return url.split('?')[0];
}

/**
 * Production-grade distributed rate limiter middleware.
 *
 * @param {Object} options
 * @param {number|function} options.limit - Base requests per window, or (req, identity) => number
 * @param {number|function} options.windowMs - Window in ms, or (req, identity) => number
 * @param {string} options.strategyName - TokenBucket (default), SlidingWindowCounter, SlidingWindowLog, FixedWindow
 * @param {string} options.identifier - 'apiKeyOrIp' (default), 'apiKey', 'ip' or 'endpoint'
 * @param {string} options.scope - Bucket namespace, so different limiters never share counters
 * @param {boolean} options.applyTierMultiplier - Scale the limit by the caller's tier (default true)
 * @param {function} options.validateApiKey - Override API key verification (tests)
 */
export const rateLimiter = (options = {}) => {
  const {
    limit = 100,
    windowMs = 60 * 1000,
    strategyName = 'TokenBucket',
    identifier = 'apiKeyOrIp',
    scope = 'default',
    applyTierMultiplier = true,
    validateApiKey,
  } = options;

  const strategy = getStrategy(strategyName);

  return async (req, res, next) => {
    let identity;
    try {
      identity = await resolveRateLimitIdentity(req, { validateApiKey });
    } catch {
      const ip = req.clientIp || resolveClientIp(req);
      identity = { id: `ip:${ip}`, tier: 'anonymous', verified: false, ip };
    }

    let id;
    if (identifier === 'ip') {
      id = `ip:${identity.ip}`;
    } else if (identifier === 'endpoint') {
      id = `${identity.ip}:${requestPath(req)}`;
    } else {
      id = identity.id;
    }

    const key = `ratelimit:${scope}:${id}`;

    try {
      const start = performance.now();
      const baseLimit =
        typeof limit === 'function' ? limit(req, identity) : limit;
      const multiplier = applyTierMultiplier
        ? (TIER_MULTIPLIERS[identity.tier] ?? 1)
        : 1;
      const requestLimit = Math.max(1, Math.floor(baseLimit * multiplier));
      const requestWindowMs =
        typeof windowMs === 'function' ? windowMs(req, identity) : windowMs;

      const result = await strategy.check(
        redisService,
        key,
        requestLimit,
        requestWindowMs
      );
      const duration = performance.now() - start;

      // Observability: Log if check exceeds performance threshold
      if (duration > 10) {
        console.warn(`Rate limiter took ${duration.toFixed(2)}ms for ${key}`);
      }

      const retryAfterSec =
        result.retryAfter || Math.ceil(requestWindowMs / 1000);
      const resetTimestamp = Math.ceil(
        (Date.now() + retryAfterSec * 1000) / 1000
      );
      const remaining = Math.max(0, requestLimit - (result.current || 0));

      res.set({
        'X-RateLimit-Limit': requestLimit,
        'X-RateLimit-Remaining': remaining,
        'X-RateLimit-Reset': String(resetTimestamp),
      });
      req.rateLimit = {
        scope,
        tier: identity.tier,
        limit: requestLimit,
        remaining,
      };

      if (!result.allowed) {
        res.set('Retry-After', String(retryAfterSec));

        await redisService.logAnalytics(
          requestPath(req),
          identity.ip,
          'blocked'
        );

        return next(
          createHttpError(429, 'Too Many Requests', {
            retryAfter: retryAfterSec,
            reset: resetTimestamp,
          })
        );
      }

      await redisService.logAnalytics(requestPath(req), identity.ip, 'allowed');
      next();
    } catch (err) {
      console.error('Rate Limiter Middleware Error:', err);
      next(); // Fail open to maintain availability during service failure
    }
  };
};

/**
 * Factory function to create rate limit middleware with config
 * @param {string} configKey - Key from config.rateLimit (e.g., 'global', 'compile', 'deploy', 'invoke')
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

  // The global limiter already has a dedicated `authenticated` quota for
  // verified callers, so tier multipliers only apply to route limiters.
  const isGlobal = configKey === 'global';
  const pickConfig = (identity) =>
    isGlobal && identity?.verified && config.rateLimit.authenticated
      ? config.rateLimit.authenticated
      : defaultRateLimitConfig;

  return rateLimiter({
    limit: options.limit ?? ((_req, identity) => pickConfig(identity).max),
    windowMs:
      options.windowMs ?? ((_req, identity) => pickConfig(identity).windowMs),
    strategyName: options.strategyName || 'TokenBucket',
    identifier: options.identifier || 'apiKeyOrIp',
    scope: options.scope || configKey,
    applyTierMultiplier: options.applyTierMultiplier ?? !isGlobal,
    validateApiKey: options.validateApiKey,
  });
};
