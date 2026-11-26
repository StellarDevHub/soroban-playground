import crypto from 'crypto';
import { LRUCache } from 'lru-cache';

export const API_KEY_CACHE_TTL_MS = 60 * 1000;

export const apiKeyCache = new LRUCache({
  max: 10_000,
  ttl: API_KEY_CACHE_TTL_MS,
});

export function cacheKeyForApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function clearApiKeyCache() {
  apiKeyCache.clear();
}
