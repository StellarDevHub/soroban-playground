// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import crypto from 'crypto';
import etag from 'etag';
import redisService from '../services/redisService.js';

/**
 * Express middleware for API response serialization caching with Redis.
 *
 * @param {Object} options Configuration options
 * @param {string} options.prefix Prefix for Redis cache keys (e.g., 'search:')
 * @param {number} options.ttl Cache TTL in seconds (default: 300)
 * @param {string[]} options.headers Request headers to include in cache key generation
 * @param {string} options.bypassHeader Header name to bypass cache (default: 'x-cache-bypass')
 */
export function responseCacheMiddleware(options = {}) {
  const prefix = options.prefix || 'response:';
  const ttl = options.ttl || 300;
  const cacheHeaders = options.headers || [];
  const bypassHeader = (options.bypassHeader || 'x-cache-bypass').toLowerCase();

  return async (req, res, next) => {
    // Only cache GET and POST requests
    if (req.method !== 'GET' && req.method !== 'POST') {
      return next();
    }

    // Check for developer/client cache bypass
    const hasBypassHeader = req.headers[bypassHeader] === 'true';
    const hasNoCacheControl = req.headers['cache-control'] === 'no-cache' || req.headers['cache-control'] === 'no-store';
    const hasPragmaNoCache = req.headers['pragma'] === 'no-cache';

    if (hasBypassHeader || hasNoCacheControl || hasPragmaNoCache) {
      res.setHeader('X-Cache', 'BYPASS');
      return next();
    }

    // Generate unique cache key
    const parts = [req.method, req.path];

    // Add query parameters (sorted to avoid key mismatch on parameter order)
    const sortedQueryKeys = Object.keys(req.query).sort();
    if (sortedQueryKeys.length > 0) {
      const queryParts = sortedQueryKeys.map((key) => `${key}=${req.query[key]}`);
      parts.push(`query:${queryParts.join('&')}`);
    }

    // Add body parameters for POST requests
    if (req.method === 'POST' && req.body) {
      parts.push(`body:${JSON.stringify(req.body)}`);
    }

    // Add headers if specified
    if (cacheHeaders.length > 0) {
      const headerParts = {};
      for (const header of cacheHeaders.sort()) {
        const val = req.headers[header.toLowerCase()];
        if (val !== undefined) {
          headerParts[header.toLowerCase()] = val;
        }
      }
      parts.push(`headers:${JSON.stringify(headerParts)}`);
    }

    const rawKey = parts.join('|');
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const cacheKey = `${prefix}${hash}`;

    try {
      // Attempt to retrieve from Redis
      const cachedResponse = await redisService.get(cacheKey);

      if (cachedResponse !== null) {
        const responseEtag = etag(cachedResponse);

        res.setHeader('X-Cache', 'HIT');
        res.setHeader('ETag', responseEtag);
        res.setHeader('Cache-Control', `public, max-age=${ttl}`);

        // Handle conditional GET
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === responseEtag) {
          return res.status(304).end();
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.send(cachedResponse);
      }
    } catch (err) {
      console.error('Cache retrieval error:', err);
      // Fall through to database/business logic on cache service failures
    }

    // Cache Miss
    res.setHeader('X-Cache', 'MISS');

    // Intercept response send
    const originalSend = res.send;
    res.send = function (body) {
      // Only cache successful 200 JSON/Text responses
      if (res.statusCode === 200) {
        let bodyStr = body;
        if (Buffer.isBuffer(body)) {
          bodyStr = body.toString('utf8');
        }

        if (typeof bodyStr === 'string') {
          // Asynchronously write to Redis (fire-and-forget to preserve latency)
          redisService.set(cacheKey, bodyStr, ttl).catch((err) => {
            console.error('Failed to save response to cache:', err);
          });

          // Inject standard headers
          res.setHeader('Cache-Control', `public, max-age=${ttl}`);
          res.setHeader('ETag', etag(bodyStr));
        }
      }

      return originalSend.apply(res, arguments);
    };

    next();
  };
}

export default responseCacheMiddleware;
