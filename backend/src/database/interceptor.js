// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

// Production: Database Query Performance Analyzer & Slow Query Alerting Interceptor
// Logs and alerts on any Knex query taking longer than 200ms in production

import { createHistogram, createCounter, register } from 'prom-client';
import { v4 as uuidv4 } from 'uuid';

/**
 * Query performance threshold in milliseconds
 */
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS, 10) || 200;

/**
 * Enable query logging in production
 */
const ENABLE_QUERY_LOGGING = process.env.NODE_ENV === 'production' || process.env.ENABLE_QUERY_LOGGING === 'true';

/**
 * Query type categorization
 */
export const QUERY_TYPE = {
  SELECT: 'select',
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
  TRANSACTION: 'transaction',
  RAW: 'raw',
  OTHER: 'other',
};

/**
 * Metrics for query performance tracking
 */
const queryDurationHistogram = new Histogram({
  name: 'db_query_duration_milliseconds',
  help: 'Duration of database queries in milliseconds',
  labelNames: ['query_type', 'table', 'operation'],
  buckets: [5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000],
});

const slowQueryCounter = new Counter({
  name: 'db_slow_query_total',
  help: 'Total number of slow queries',
  labelNames: ['query_type', 'table', 'operation'],
});

const queryErrorCounter = new Counter({
  name: 'db_query_error_total',
  help: 'Total number of query errors',
  labelNames: ['query_type', 'table', 'error_type'],
});

/**
 * Custom Histogram implementation if prom-client not available
 */
class Histogram {
  constructor({ name, help, labelNames, buckets }) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.buckets = buckets;
    this.values = new Map();
  }

  observe(labels, value) {
    const key = JSON.stringify(labels);
    if (!this.values.has(key)) {
      this.values.set(key, []);
    }
    this.values.get(key).push({ value, timestamp: Date.now() });
  }

  reset() {
    this.values.clear();
  }
}

/**
 * Custom Counter implementation if prom-client not available
 */
class Counter {
  constructor({ name, help, labelNames }) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map();
  }

  inc(labels = {}, amount = 1) {
    const key = JSON.stringify(labels);
    const current = this.values.get(key) || 0;
    this.values.set(key, current + amount);
  }

  reset() {
    this.values.clear();
  }
}

/**
 * Determine query type from SQL
 * @param {string} sql - SQL query
 * @returns {string}
 */
function categorizeQuery(sql) {
  const normalized = sql.trim().toUpperCase();
  
  if (normalized.startsWith('SELECT')) return QUERY_TYPE.SELECT;
  if (normalized.startsWith('INSERT')) return QUERY_TYPE.INSERT;
  if (normalized.startsWith('UPDATE')) return QUERY_TYPE.UPDATE;
  if (normalized.startsWith('DELETE')) return QUERY_TYPE.DELETE;
  if (normalized.includes('BEGIN') || normalized.includes('COMMIT') || normalized.includes('ROLLBACK')) {
    return QUERY_TYPE.TRANSACTION;
  }
  if (normalized.startsWith('/*') || !/^\s*\w+/.test(normalized)) return QUERY_TYPE.RAW;
  
  return QUERY_TYPE.OTHER;
}

/**
 * Extract table name from SQL query
 * @param {string} sql - SQL query
 * @returns {string}
 */
function extractTableName(sql) {
  const normalized = sql.toUpperCase();
  
  // Match common patterns
  const patterns = [
    /(?:FROM|JOIN|UPDATE|INTO)\s+([a-zA-Z0-9_]+)/i,
    /CREATE\s+TABLE\s+([a-zA-Z0-9_]+)/i,
    /ALTER\s+TABLE\s+([a-zA-Z0-9_]+)/i,
    /DROP\s+TABLE\s+([a-zA-Z0-9_]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) return match[1];
  }
  
  return 'unknown';
}

/**
 * Sanitize SQL for logging (remove sensitive data)
 * @param {string} sql - SQL query
 * @returns {string}
 */
function sanitizeSQL(sql) {
  // Replace numeric literals that might be sensitive
  let sanitized = sql.replace(/\d{4,}/g, '[NUMERIC]');
  
  // Replace string literals that might contain PII
  sanitized = sanitized.replace(/'[^']*'/g, "'[STRING]'");
  
  // Replace quoted identifiers
  sanitized = sanitized.replace(/"[^"]*"/g, '"[IDENTIFIER]"');
  
  // Limit length
  if (sanitized.length > 1000) {
    sanitized = sanitized.substring(0, 1000) + '...';
  }
  
  return sanitized;
}

/**
 * Log slow query with details
 * @param {object} queryInfo - Query information
 */
function logSlowQuery(queryInfo) {
  const { sql, duration, queryType, table, operation, requestId, userId } = queryInfo;
  
  const logEntry = {
    level: 'warn',
    message: 'Slow database query detected',
    timestamp: new Date().toISOString(),
    requestId,
    userId,
    query: {
      type: queryType,
      table,
      operation,
      durationMs: duration,
      thresholdMs: SLOW_QUERY_THRESHOLD_MS,
      sql: sanitizeSQL(sql),
    },
  };
  
  // Console output
  console.warn('[SLOW_QUERY]', JSON.stringify(logEntry));
  
  // Emit custom event for external alerting
  if (typeof process.emitWarning === 'function') {
    process.emitWarning(`Slow query: ${queryType} on ${table} took ${duration}ms`, {
      code: 'SLOW_QUERY',
      detail: JSON.stringify(logEntry),
    });
  }
}

/**
 * Log query error
 * @param {object} errorInfo - Error information
 */
function logQueryError(errorInfo) {
  const { sql, error, queryType, table, requestId, userId } = errorInfo;
  
  const logEntry = {
    level: 'error',
    message: 'Database query error',
    timestamp: new Date().toISOString(),
    requestId,
    userId,
    query: {
      type: queryType,
      table,
      sql: sanitizeSQL(sql),
    },
    error: {
      message: error?.message || 'Unknown error',
      code: error?.code,
      stack: error?.stack,
    },
  };
  
  console.error('[QUERY_ERROR]', JSON.stringify(logEntry));
}

/**
 * Create query context with tracking
 * @param {object} options - Options
 * @returns {object} Context object
 */
export function createQueryContext(options = {}) {
  return {
    requestId: options.requestId || uuidv4(),
    userId: options.userId,
    startTime: Date.now(),
    tags: options.tags || {},
  };
}

/**
 * Database Query Interceptor for Knex
 * Wraps query execution to measure performance and log slow queries
 */
export function createQueryInterceptor(db, options = {}) {
  const {
    slowThreshold = SLOW_QUERY_THRESHOLD_MS,
    enableMetrics = ENABLE_QUERY_LOGGING,
    onSlowQuery = logSlowQuery,
    onQueryError = logQueryError,
  } = options;

  // Store original query method
  const originalRaw = db.raw.bind(db);
  const originalSelect = db.select.bind(db);
  const originalInsert = db.insert.bind(db);
  const originalUpdate = db.update.bind(db);
  const originalDel = db.del.bind(db);

  /**
   * Wrap query execution with timing and logging
   */
  function wrapQuery(executeQuery, sql, bindings, context = {}) {
    const startTime = Date.now();
    const queryType = categorizeQuery(sql);
    const table = extractTableName(sql);
    const operation = context.operation || 'execute';
    
    return async (...args) => {
      const requestId = context.requestId || uuidv4();
      const userId = context.userId;
      
      try {
        const result = await executeQuery(...args);
        const duration = Date.now() - startTime;
        
        // Record metrics
        if (enableMetrics) {
          const labels = { query_type: queryType, table, operation };
          queryDurationHistogram.observe(labels, duration);
          
          // Log slow queries
          if (duration >= slowThreshold) {
            slowQueryCounter.inc(labels);
            
            onSlowQuery({
              sql,
              duration,
              queryType,
              table,
              operation,
              requestId,
              userId,
            });
          }
        }
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        if (enableMetrics) {
          queryErrorCounter.inc({
            query_type: queryType,
            table,
            error_type: error?.code || 'UNKNOWN',
          });
          
          onQueryError({
            sql,
            error,
            queryType,
            table,
            requestId,
            userId,
          });
        }
        
        throw error;
      }
    };
  }

  // Override raw method
  db.raw = function (sql, bindings) {
    const context = this._queryContext || {};
    const wrapped = wrapQuery(
      () => originalRaw(sql, bindings),
      typeof sql === 'string' ? sql : sql?.sql || 'unknown',
      bindings,
      context
    );
    
    const result = wrapped();
    if (result?.then) {
      return result.then(data => {
        if (Array.isArray(data)) {
          return data.map(item => {
            if (item && typeof item === 'object') {
              item._queryMetrics = { duration: Date.now() - startTime };
            }
            return item;
          });
        }
        return data;
      });
    }
    return result;
  };

  return db;
}

/**
 * Create migration-specific interceptor for tracking schema changes
 */
export function createMigrationInterceptor(db) {
  const startTime = Date.now();
  
  console.log('[MIGRATION] Starting database migration');
  
  const originalMigrate = db.migrate;
  
  db.migrate = function (...args) {
    const migrationStart = Date.now();
    
    console.log('[MIGRATION]', {
      action: args[0] || 'latest',
      timestamp: new Date().toISOString(),
    });
    
    return originalMigrate.apply(this, args)
      .then(result => {
        const duration = Date.now() - migrationStart;
        console.log('[MIGRATION] Completed', {
          durationMs: duration,
          result,
        });
        return result;
      })
      .catch(error => {
        console.error('[MIGRATION] Failed', {
          durationMs: Date.now() - migrationStart,
          error: error.message,
        });
        throw error;
      });
  };
  
  return db;
}

/**
 * Knex query builder middleware for timing
 */
export function withQueryTiming(knexQuery, context = {}) {
  const startTime = Date.now();
  
  const originalThen = knexQuery.then.bind(knexQuery);
  
  knexQuery.then = function (...args) {
    const query = this;
    const sql = query.toSQL()?.sql || 'unknown';
    const queryType = categorizeQuery(sql);
    
    return originalThen(...args)
      .then(result => {
        const duration = Date.now() - startTime;
        
        if (duration >= SLOW_QUERY_THRESHOLD_MS && ENABLE_QUERY_LOGGING) {
          logSlowQuery({
            sql,
            duration,
            queryType,
            table: extractTableName(sql),
            operation: 'query',
            requestId: context.requestId,
            userId: context.userId,
          });
        }
        
        return result;
      })
      .catch(error => {
        const duration = Date.now() - startTime;
        
        logQueryError({
          sql,
          error,
          queryType,
          table: extractTableName(sql),
          requestId: context.requestId,
          userId: context.userId,
        });
        
        throw error;
      });
  };
  
  return knexQuery;
}

/**
 * Express middleware to add query context to requests
 */
export function queryContextMiddleware(options = {}) {
  return (req, res, next) => {
    req.queryContext = createQueryContext({
      requestId: req.id || uuidv4(),
      userId: req.user?.id || req.session?.user?.id,
      tags: options.tags || {},
    });
    
    next();
  };
}

/**
 * Get current query metrics
 */
export function getQueryMetrics() {
  return {
    histogram: queryDurationHistogram.values,
    slowQueries: slowQueryCounter.values,
    errors: queryErrorCounter.values,
  };
}

/**
 * Reset metrics (for testing)
 */
export function resetQueryMetrics() {
  queryDurationHistogram.reset();
  slowQueryCounter.reset();
  queryErrorCounter.reset();
}

/**
 * Configuration getter
 */
export function getInterceptorConfig() {
  return {
    slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
    enableQueryLogging: ENABLE_QUERY_LOGGING,
  };
}

export default {
  createQueryInterceptor,
  createMigrationInterceptor,
  withQueryTiming,
  queryContextMiddleware,
  getQueryMetrics,
  resetQueryMetrics,
  getInterceptorConfig,
  QUERY_TYPE,
};