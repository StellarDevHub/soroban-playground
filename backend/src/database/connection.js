import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

function enhanceDatabaseError(error, context) {
  const detail = context ? ` (${context})` : '';
  const enhanced = new Error(
    `Database initialization error${detail}: ${error.message}`
  );
  enhanced.cause = error;
  enhanced.code = error.code;
  return enhanced;
}

// Opens a fresh database handle and applies the schema. Used by both the
// initial boot and runtime credential rotation (where we open the new handle
// before swapping it in).
async function openDatabase(options = {}) {
  const {
    filename = path.join(__dirname, 'database.sqlite'),
    schemaPath = path.join(__dirname, 'schema.sql'),
    seedSampleData = process.env.SEED_SAMPLE_DATA !== 'false',
  } = options;

  const handle = await open({
    filename,
    driver: sqlite3.Database,
  });

  // WAL mode allows readers to proceed without blocking during writes (e.g. index building)
  await handle.run('PRAGMA journal_mode = WAL');
  await handle.run('PRAGMA synchronous = NORMAL');

  // Query Profiling & Slow Query Logging
  const thresholdMs = process.env.SLOW_QUERY_THRESHOLD_MS
    ? parseInt(process.env.SLOW_QUERY_THRESHOLD_MS, 10)
    : 50;
  const methodsToWrap = ['run', 'get', 'all', 'exec'];

  methodsToWrap.forEach((method) => {
    const original = handle[method].bind(handle);
    handle[method] = async function (...args) {
      const startTime = process.hrtime.bigint();
      const traceId = Math.random().toString(36).substring(2, 15);

      try {
        return await original(...args);
      } finally {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1000000;

        if (durationMs > thresholdMs) {
          const query = args[0];
          const params = args.slice(1);

          console.warn(
            JSON.stringify({
              level: 'warn',
              message: 'Slow query detected',
              traceId,
              durationMs,
              query: typeof query === 'string' ? query : 'unknown',
              params,
            })
          );

          if (
            typeof query === 'string' &&
            query
              .trim()
              .toUpperCase()
              .match(/^(SELECT|UPDATE|DELETE|INSERT)/)
          ) {
            try {
              const plan = await original(
                `EXPLAIN QUERY PLAN ${query}`,
                ...params
              );
              console.warn(
                JSON.stringify({
                  level: 'warn',
                  message: 'Slow query plan',
                  traceId,
                  plan,
                })
              );
            } catch (e) {
              // ignore
            }
          }
        }
      }
    };
  });
  const { withCacheBusting } = await import('./cacheInterceptor.js');
  const { wrapPreparedDatabase } = await import('./safeQuery.js');
  const wrappedHandle = wrapPreparedDatabase(withCacheBusting(handle));

  // Schema execution moved to knex migrations

  return wrappedHandle;
}

export async function initializeDatabase(options = {}) {
  if (db) return db;

  try {
    db = await openDatabase(options);
    console.log('Database initialized successfully');
    return db;
  } catch (error) {
    if (db) {
      await db.close().catch(() => {});
      db = null;
    }
    console.error(error.message);
    throw error;
  }
}

/**
 * Reconnects the database without a restart (for credential rotation). Opens the
 * new handle first, swaps it in atomically, then closes the old handle after a
 * grace period — SQLite has no connection pool to drain, so the delay lets any
 * request that already captured the old handle finish.
 */
export async function refreshDatabaseConnection(options = {}) {
  const { graceMs = 5000, ...openOptions } = options;
  const next = await openDatabase(openOptions);
  const previous = db;
  db = next; // atomic swap

  if (previous && previous !== next) {
    const timer = setTimeout(() => {
      previous.close().catch(() => {});
    }, graceMs);
    if (timer.unref) timer.unref();
  }

  return db;
}

export function getDatabase() {
  if (!db) {
    throw new Error(
      'Database not initialized. Call initializeDatabase() first.'
    );
  }
  return db;
}

export async function closeDatabase() {
  if (db) {
    await db.close();
    db = null;
  }
}
