// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { createHttpError } from './errorHandler.js';

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 10;

// Map<ip, { count: number, resetAt: number }>
const store = new Map();

/**
 * Simple in-memory rate limiter: 10 requests per minute per IP.
 */
export function notaryRateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  let entry = store.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }

  entry.count += 1;
  const remaining = Math.max(0, MAX_REQUESTS - entry.count);

  res.set('X-RateLimit-Limit', String(MAX_REQUESTS));
  res.set('X-RateLimit-Remaining', String(remaining));

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return next(createHttpError(429, 'Too Many Requests'));
  }

  next();
}
