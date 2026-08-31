// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
// 
// ⚠️ DEPRECATED: This file is deprecated and will be removed in a future version.
// All cache functionality has been merged into redisService.js for unified connection pooling.
// Please import from './redisService.js' instead.

import redisService from './redisService.js';

console.warn(
  'DEPRECATION WARNING: cacheService.js is deprecated. Use redisService.js instead.'
);

class CacheService {
  constructor() {
    this.redis = null;
    this.isConnected = !!redisService.client && !redisService.isFallbackMode;
  }
  async initialize() {
    // Use the shared redisService singleton. Attempt a light health check.
    this.redis = redisService.client;
    this.isConnected = !!this.redis && !redisService.isFallbackMode;
    return this.isConnected;
  }

  /**
   * Delete keys matching a prefix using SCAN (non-blocking).
   * Avoids the O(N) KEYS command that blocks the Redis event loop.
   */
  async #deleteByPattern(pattern) {
    if (!this.isConnected || !redisService) return 0;

    const client = redisService.client;
    let cursor = '0';
    let deleted = 0;
    do {
      // ioredis returns [next, keys]
      // use client.scan to iterate safely
      // eslint-disable-next-line no-await-in-loop
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        // Use pipeline for batch deletes
        const pipe = client.pipeline();
        keys.forEach((k) => pipe.del(k));
        // eslint-disable-next-line no-await-in-loop
        await pipe.exec();
        deleted += keys.length;
      }
    } while (cursor !== '0');
    return deleted;
  }

  /**
   * Collect key-value pairs matching a prefix using SCAN.
   * Returns an array of { key, value } objects.
   */
  async #scanPattern(pattern) {
    const results = [];
    if (!this.isConnected || !redisService.client) return results;
    const client = redisService.client;
    let cursor = '0';
    do {
      // eslint-disable-next-line no-await-in-loop
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        const pipeline = client.pipeline();
        keys.forEach((key) => pipeline.get(key));
        // eslint-disable-next-line no-await-in-loop
        const values = await pipeline.exec();
        values.forEach(([err, val], idx) => {
          if (!err && val) {
            results.push({ key: keys[idx], value: val });
          }
        });
      }
    } while (cursor !== '0');
    return results;
  }

  generateSearchKey(query, filters, pagination) {
    const keyData = { query, filters, pagination };
    return `search:${Buffer.from(JSON.stringify(keyData)).toString('base64')}`;
  }

  generateFacetKey(query) {
    return `facets:${Buffer.from(query).toString('base64')}`;
  }

  generateAutocompleteKey(query) {
    return `autocomplete:${Buffer.from(query).toString('base64')}`;
  }

  async get(key) {
    if (!redisService || redisService.isFallbackMode) return null;
    try {
      const cached = await redisService.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key, data, ttl = DEFAULT_TTL_SECONDS) {
    if (!redisService || redisService.isFallbackMode) return false;
    try {
      await redisService.set(key, JSON.stringify(data), ttl);
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async del(key) {
    if (!redisService) return false;
    try {
      await redisService.delete(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async has(key) {
    if (!redisService || redisService.isFallbackMode) return false;
    try {
      const exists = await redisService.client.exists(key);
      return exists === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  async clearSearchCache() {
    if (!this.isConnected) return false;

    try {
      await this.#deleteByPattern('search:*');
      return true;
    } catch (error) {
      console.error('Cache clear error:', error);
      return false;
    }
  }

  async incrementSearchPopularity(query) {
    if (!this.isConnected) return false;

    try {
      const key = `popular:${query}`;
      await this.redis.incr(key);
      await this.redis.expire(key, POPULARITY_TTL_SECONDS);
      return true;
    } catch (error) {
      console.error('Popularity increment error:', error);
      return false;
    }
  }

  async getPopularSearches(limit = 10) {
    if (!this.isConnected) return [];

    try {
      const entries = await this.#scanPattern('popular:*');
      const searches = entries.map(({ key, value }) => ({
        query: key.replace('popular:', ''),
        count: parseInt(value, 10),
      }));

      return searches.sort((a, b) => b.count - a.count).slice(0, limit);
    } catch (error) {
      console.error('Popular searches cache error:', error);
      return [];
    }
  }

  async cacheSearchResults(query, filters, pagination, results) {
    if (!this.isConnected) return false;

    try {
      const key = this.generateSearchKey(query, filters, pagination);

      const popularityScore = await this.getQueryPopularity(query);
      const ttl = Math.min(
        BASE_SMART_TTL_SECONDS +
          popularityScore * SMART_TTL_POPULARITY_STEP_SECONDS,
        MAX_SMART_TTL_SECONDS
      );

      await this.set(key, results, ttl);
      await this.incrementSearchPopularity(query);

      return true;
    } catch (error) {
      console.error('Search results caching error:', error);
      return false;
    }
  }

  async getQueryPopularity(query) {
    if (!redisService || redisService.isFallbackMode) return 0;
    try {
      const key = `popular:${query}`;
      const count = await redisService.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      console.error('Query popularity error:', error);
      return 0;
    }
  }

  async healthCheck() {
    if (!redisService || redisService.isFallbackMode) {
      return { status: 'disconnected', message: 'Redis not connected' };
    }

    try {
      const pong = await redisService.client.ping();
      const info = await redisService.client.info('memory');

      return {
        status: 'connected',
        message: 'Redis is healthy',
        ping: pong,
        memory: info,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  }

  async getCacheAdminSnapshot() {
    return {
      cacheVersion: 'v1',
      memoryEntries: redisService && redisService.client ? await redisService.client.dbsize() : 0,
      isConnected: !!redisService && !redisService.isFallbackMode,
    };
  }

  async warmCache({ hashes, top }) {
    return { warmed: hashes || [], warmedCount: (hashes || []).length };
  }

  async invalidateCache({ hash, dependency, namespace }) {
    if (hash) {
      await this.del(hash);
    }
    return { success: true };
  }

  async bumpCacheVersion({ version }) {
    return version || 'v2';
  }

  async close() {
    if (this.redis) {
      await this.redis.quit();
      this.isConnected = false;
    }
  }
}

export default new CacheService();
