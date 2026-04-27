import Redis from 'ioredis';

class CacheService {
  constructor() {
    this.redis = null;
    this.isConnected = false;
  }

  async initialize() {
    try {
      // Redis configuration - can be configured via environment variables
      this.redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: process.env.REDIS_DB || 0,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });

      this.redis.on('connect', () => {
        console.log('Redis connected successfully');
        this.isConnected = true;
      });

      this.redis.on('error', (err) => {
        console.error('Redis connection error:', err);
        this.isConnected = false;
      });

      this.redis.on('close', () => {
        console.log('Redis connection closed');
        this.isConnected = false;
      });

      await this.redis.connect();
      return true;
    } catch (error) {
      console.error('Redis initialization failed:', error);
      this.isConnected = false;
      return false;
    }
  }

  // Generate cache key for search results
  generateSearchKey(query, filters, pagination) {
    const keyData = {
      query,
      filters,
      pagination
    };
    return `search:${Buffer.from(JSON.stringify(keyData)).toString('base64')}`;
  }

  // Generate cache key for facet counts
  generateFacetKey(query) {
    return `facets:${Buffer.from(query).toString('base64')}`;
  }

  // Generate cache key for autocomplete
  generateAutocompleteKey(query) {
    return `autocomplete:${Buffer.from(query).toString('base64')}`;
  }

  // Get cached data
  async get(key) {
    if (!this.isConnected) return null;
    
    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  // Set cache data with TTL
  async set(key, data, ttl = 300) { // Default 5 minutes
    if (!this.isConnected) return false;
    
    try {
      await this.redis.setex(key, ttl, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  // Delete cache key
  async del(key) {
    if (!this.isConnected) return false;
    
    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  // Clear all search-related cache
  async clearSearchCache() {
    if (!this.isConnected) return false;
    
    try {
      const keys = await this.redis.keys('search:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return true;
    } catch (error) {
      console.error('Cache clear error:', error);
      return false;
    }
  }

  // Increment search popularity counter
  async incrementSearchPopularity(query) {
    if (!this.isConnected) return false;
    
    try {
      const key = `popular:${query}`;
      await this.redis.incr(key);
      await this.redis.expire(key, 86400 * 7); // Keep for 7 days
      return true;
    } catch (error) {
      console.error('Popularity increment error:', error);
      return false;
    }
  }

  // Get popular searches from cache
  async getPopularSearches(limit = 10) {
    if (!this.isConnected) return [];
    
    try {
      const keys = await this.redis.keys('popular:*');
      const pipeline = this.redis.pipeline();
      
      keys.forEach(key => {
        pipeline.get(key);
      });
      
      const results = await pipeline.exec();
      const searches = [];
      
      results.forEach(([err, count], index) => {
        if (!err && count) {
          const query = keys[index].replace('popular:', '');
          searches.push({ query, count: parseInt(count) });
        }
      });
      
      return searches
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
    } catch (error) {
      console.error('Popular searches cache error:', error);
      return [];
    }
  }

  // Cache search results with smart TTL based on query complexity
  async cacheSearchResults(query, filters, pagination, results) {
    if (!this.isConnected) return false;
    
    try {
      const key = this.generateSearchKey(query, filters, pagination);
      
      // Smart TTL: more popular queries get longer cache time
      const popularityScore = await this.getQueryPopularity(query);
      const ttl = Math.min(300 + (popularityScore * 60), 1800); // 5-30 minutes
      
      await this.set(key, results, ttl);
      await this.incrementSearchPopularity(query);
      
      return true;
    } catch (error) {
      console.error('Search results caching error:', error);
      return false;
    }
  }

  // Get query popularity score
  async getQueryPopularity(query) {
    if (!this.isConnected) return 0;
    
    try {
      const key = `popular:${query}`;
      const count = await this.redis.get(key);
      return count ? parseInt(count) : 0;
    } catch (error) {
      console.error('Query popularity error:', error);
      return 0;
    }
  }

  // Check cache health
  async healthCheck() {
    if (!this.isConnected) {
      return { status: 'disconnected', message: 'Redis not connected' };
    }
    
    try {
      const pong = await this.redis.ping();
      const info = await this.redis.info('memory');
      
      return {
        status: 'connected',
        message: 'Redis is healthy',
        ping: pong,
        memory: info
      };
    } catch (error) {
      return {
        status: 'error',
        message: error.message
      };
    }
  }

  // Close Redis connection
  async close() {
    if (this.redis) {
      await this.redis.quit();
      this.isConnected = false;
    }
  }
}

export default new CacheService();
