// Query result cache backed by Redis with LRU memory fallback.
// Mutations and subscriptions are never cached.
// Cache keys are SHA-256 hashes of (operationName + variables JSON).

import crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import redisService from '../services/redisService.js';

const DEFAULT_TTL_MS = 30_000; // 30 s
const CACHE_PREFIX = 'gql:cache:';

const memCache = new LRUCache({
  max: 500,
  ttl: DEFAULT_TTL_MS,
});

function cacheKey(operationName, variables) {
  const raw = `${operationName ?? 'anonymous'}:${JSON.stringify(variables ?? {})}`;
  return CACHE_PREFIX + crypto.createHash('sha256').update(raw).digest('hex');
}

export async function getCached(operationName, variables) {
  const key = cacheKey(operationName, variables);

  if (!redisService.isFallbackMode && redisService.client) {
    try {
      const val = await redisService.client.get(key);
      if (val) return JSON.parse(val);
    } catch {
      // fall through to memory cache
    }
  }

  return memCache.get(key) ?? null;
}

export async function setCached(
  operationName,
  variables,
  data,
  ttlMs = DEFAULT_TTL_MS
) {
  const key = cacheKey(operationName, variables);

  if (!redisService.isFallbackMode && redisService.client) {
    try {
      await redisService.client.set(key, JSON.stringify(data), 'PX', ttlMs);
    } catch {
      // fall through
    }
  }

  memCache.set(key, data, { ttl: ttlMs });
}

export async function invalidateCache(pattern) {
  // Invalidate all keys matching a prefix pattern (used after mutations)
  if (!redisService.isFallbackMode && redisService.client) {
    try {
      const keys = await redisService.client.keys(`${CACHE_PREFIX}*`);
      if (keys.length) await redisService.client.del(...keys);
    } catch {
      // ignore
    }
  }
  // Clear memory cache entirely on mutation — simple and safe
  memCache.clear();
}
