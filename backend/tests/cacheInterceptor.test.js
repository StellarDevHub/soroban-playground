import {
  extractTableName,
  invalidateCacheForTable,
  withCacheBusting,
} from '../src/database/cacheInterceptor.js';
import multiLevelCache from '../src/services/multiLevelCache.js';
import cacheService from '../src/services/cacheService.js';

jest.mock('../src/services/multiLevelCache.js', () => ({
  __esModule: true,
  default: {
    invalidatePattern: jest.fn().mockResolvedValue(),
  },
}));

jest.mock('../src/services/cacheService.js', () => ({
  __esModule: true,
  default: {
    clearSearchCache: jest.fn().mockResolvedValue(),
  },
}));

describe('Cache Interceptor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractTableName', () => {
    it('should extract table from INSERT', () => {
      expect(extractTableName('INSERT INTO projects (title) VALUES (?)')).toBe(
        'projects'
      );
      expect(
        extractTableName('INSERT OR IGNORE INTO api_keys (key) VALUES (?)')
      ).toBe('api_keys');
    });

    it('should extract table from UPDATE', () => {
      expect(extractTableName('UPDATE users SET name = ?')).toBe('users');
    });

    it('should extract table from DELETE', () => {
      expect(extractTableName('DELETE FROM files WHERE id = ?')).toBe('files');
    });

    it('should return null for SELECT', () => {
      expect(extractTableName('SELECT * FROM projects')).toBeNull();
    });
  });

  describe('invalidateCacheForTable', () => {
    it('should invalidate projects patterns and search cache', async () => {
      await invalidateCacheForTable('projects');
      expect(multiLevelCache.invalidatePattern).toHaveBeenCalledWith('search:');
      expect(multiLevelCache.invalidatePattern).toHaveBeenCalledWith('facets:');
      expect(multiLevelCache.invalidatePattern).toHaveBeenCalledWith(
        'projects:'
      );
      expect(cacheService.clearSearchCache).toHaveBeenCalled();
    });

    it('should invalidate api_keys patterns', async () => {
      await invalidateCacheForTable('api_keys');
      expect(multiLevelCache.invalidatePattern).toHaveBeenCalledWith(
        'api_keys:'
      );
      expect(cacheService.clearSearchCache).not.toHaveBeenCalled();
    });

    it('should do nothing for unknown tables', async () => {
      await invalidateCacheForTable('unknown_table');
      expect(multiLevelCache.invalidatePattern).not.toHaveBeenCalled();
    });
  });

  describe('withCacheBusting', () => {
    it('should wrap run method and invalidate on write', (done) => {
      const mockDb = {
        run: jest.fn(function (sql, params, cb) {
          if (cb) cb.call({ lastID: 1, changes: 1 }, null);
        }),
      };

      const wrappedDb = withCacheBusting(mockDb);
      wrappedDb.run(
        'INSERT INTO projects (title) VALUES (?)',
        ['Test'],
        async (err) => {
          expect(err).toBeNull();
          // Allow microtasks to complete
          await Promise.resolve();
          expect(multiLevelCache.invalidatePattern).toHaveBeenCalled();
          done();
        }
      );
    });

    it('should support Promise based run', async () => {
      const mockDb = {
        run: jest.fn().mockResolvedValue({ changes: 1 }),
      };

      const wrappedDb = withCacheBusting(mockDb);
      await wrappedDb.run('UPDATE users SET name = ?', ['Bob']);
      expect(multiLevelCache.invalidatePattern).toHaveBeenCalledWith('users:');
    });
  });
});
