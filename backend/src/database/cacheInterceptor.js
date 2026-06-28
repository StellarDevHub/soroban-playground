import multiLevelCache from '../services/multiLevelCache.js';
import cacheService from '../services/cacheService.js';

const TABLE_CACHE_MAP = {
  projects: ['search:', 'facets:', 'autocomplete:', 'projects:', 'popular:'],
  users: ['users:'],
  files: ['files:'],
  api_keys: ['api_keys:'],
  organizations: ['organizations:'],
  tier_limits: ['tier_limits:'],
  treasury_proposals: ['treasury:'],
  feature_flags: ['features:'],
  flag_cohorts: ['features:'],
};

export function extractTableName(sql) {
  if (!sql) return null;
  const query = sql.toString().replace(/\s+/g, ' ').trim().toUpperCase();
  let match = query.match(
    /INSERT\s+(?:OR\s+(?:IGNORE|REPLACE)\s+)?INTO\s+([A-Z0-9_]+)/
  );
  if (match) return match[1].toLowerCase();

  match = query.match(/UPDATE\s+([A-Z0-9_]+)/);
  if (match) return match[1].toLowerCase();

  match = query.match(/DELETE\s+FROM\s+([A-Z0-9_]+)/);
  if (match) return match[1].toLowerCase();

  return null;
}

export async function invalidateCacheForTable(tableName) {
  if (!tableName) return;
  const prefixes = TABLE_CACHE_MAP[tableName];
  if (!prefixes) return;

  try {
    for (const prefix of prefixes) {
      await multiLevelCache.invalidatePattern(prefix);
    }

    if (tableName === 'projects') {
      await cacheService.clearSearchCache();
    }
  } catch (error) {
    console.error(`Cache invalidation error for table ${tableName}:`, error);
  }
}

/**
 * Middleware to intercept database execution and invalidate cache.
 */
export function withCacheBusting(dbHandle) {
  // SQLite3 driver wrapper
  if (dbHandle.run && typeof dbHandle.run === 'function') {
    const originalRun = dbHandle.run.bind(dbHandle);
    dbHandle.run = function (sql, params, callback) {
      const tableName = extractTableName(sql);

      // Support Promise-based sqlite run
      if (callback === undefined && typeof params !== 'function') {
        return originalRun(sql, params).then(async (result) => {
          if (tableName) await invalidateCacheForTable(tableName);
          return result;
        });
      }

      // Callback based sqlite3
      let cb = typeof params === 'function' ? params : callback;
      let args = typeof params === 'function' ? [] : params;

      const wrappedCallback = async function (err) {
        if (!err && tableName) {
          await invalidateCacheForTable(tableName);
        }
        if (cb) cb.apply(this, arguments);
      };

      return originalRun(sql, args, wrappedCallback);
    };
  }

  // sql.js Database wrapper
  if (dbHandle.exec && typeof dbHandle.exec === 'function') {
    const originalExec = dbHandle.exec.bind(dbHandle);
    dbHandle.exec = function (sql, params) {
      const result = originalExec(sql, params);
      const tableName = extractTableName(sql);
      if (tableName) {
        // sql.js is synchronous, but we can fire and forget the cache invalidation
        invalidateCacheForTable(tableName).catch((e) => console.error(e));
      }
      return result;
    };
  }

  return dbHandle;
}
