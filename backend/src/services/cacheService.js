// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
import redisService from './redisService.js';

// Compatibility adapter for callers that store JSON objects. Redis ownership,
// reconnects, health checks and the bounded LRU all live in redisService.
class CacheService {
  get redis() {
    return redisService.client;
  }
  get isConnected() {
    return redisService.isConnected;
  }
  async initialize() {
    return redisService.initialize();
  }
  async get(key) {
    try {
      const value = await redisService.get(key);
      return value === null ? null : JSON.parse(value);
    } catch {
      return null;
    }
  }
  async set(key, data, ttl = 300) {
    try {
      await redisService.set(key, JSON.stringify(data), ttl);
      return true;
    } catch {
      return false;
    }
  }
  async del(key) {
    try {
      await redisService.del(key);
      return true;
    } catch {
      return false;
    }
  }
  async has(key) {
    return redisService.has(key);
  }
  generateSearchKey(...args) {
    return redisService.generateSearchKey(...args);
  }
  generateFacetKey(...args) {
    return redisService.generateFacetKey(...args);
  }
  generateAutocompleteKey(...args) {
    return redisService.generateAutocompleteKey(...args);
  }
  async clearSearchCache() {
    return redisService.clearSearchCache();
  }
  async incrementSearchPopularity(query) {
    return redisService.incrementSearchPopularity(query);
  }
  async getPopularSearches(limit) {
    return redisService.getPopularSearches(limit);
  }
  async cacheSearchResults(...args) {
    return redisService.cacheSearchResults(...args);
  }
  async getQueryPopularity(query) {
    return redisService.getQueryPopularity(query);
  }
  async healthCheck() {
    return redisService.healthCheck();
  }
  async getCacheAdminSnapshot() {
    return redisService.getCacheAdminSnapshot();
  }
  async warmCache(options) {
    return redisService.warmCache(options);
  }
  async invalidateCache(options) {
    return redisService.invalidateCache(options);
  }
  async bumpCacheVersion(options) {
    return redisService.bumpCacheVersion(options);
  }
  async close() {
    return redisService.close();
  }
}

export default new CacheService();
