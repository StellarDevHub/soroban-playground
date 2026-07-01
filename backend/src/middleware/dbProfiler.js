/**
 * Database query profiler middleware (#755)
 *
 * Wraps a SQLite `db` object's query methods to record per-request metrics:
 *   - count of queries executed
 *   - total duration (ms)
 *   - per-signature durations (for N+1 detection)
 *
 * Usage:
 *   app.use(createDbProfilerMiddleware(db));
 *   // In route handlers: req.dbMetrics.queries, req.dbMetrics.totalMs
 */

const DUPLICATE_QUERY_WARN_THRESHOLD = 3;
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Normalise a SQL string into a signature by collapsing whitespace and
 * stripping literal values so repeated queries with different params are
 * grouped together.
 */
function sqlSignature(sql) {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/'[^']*'/g, '?')
    .replace(/\b\d+\b/g, '?')
    .trim()
    .toLowerCase();
}

/**
 * Wraps `db.all`, `db.get`, and `db.run` to intercept timings.
 * Returns a cleanup function that restores the originals.
 */
function wrapDb(db, onQuery) {
  const originals = {};
  const methods = ['all', 'get', 'run'];

  for (const method of methods) {
    if (typeof db[method] !== 'function') continue;
    originals[method] = db[method].bind(db);
    db[method] = async function (sql, ...args) {
      const start = Date.now();
      try {
        return await originals[method](sql, ...args);
      } finally {
        onQuery(sql, Date.now() - start);
      }
    };
  }

  return function restore() {
    for (const method of methods) {
      if (originals[method]) db[method] = originals[method];
    }
  };
}

/**
 * Express middleware factory. Injects `req.dbMetrics` and wraps the db for
 * the lifetime of the request.
 */
export function createDbProfilerMiddleware(db) {
  return function dbProfilerMiddleware(req, res, next) {
    const metrics = {
      queries: 0,
      totalMs: 0,
      bySignature: {},
    };
    req.dbMetrics = metrics;

    const restore = wrapDb(db, (sql, durationMs) => {
      metrics.queries += 1;
      metrics.totalMs += durationMs;

      const sig = sqlSignature(sql);
      if (!metrics.bySignature[sig]) {
        metrics.bySignature[sig] = { count: 0, totalMs: 0 };
      }
      metrics.bySignature[sig].count += 1;
      metrics.bySignature[sig].totalMs += durationMs;
    });

    res.once('finish', () => {
      restore();

      if (IS_PROD) return;

      const dupSigs = Object.entries(metrics.bySignature).filter(
        ([, v]) => v.count >= DUPLICATE_QUERY_WARN_THRESHOLD
      );

      if (dupSigs.length > 0) {
        console.warn(
          `[dbProfiler] Possible N+1 on ${req.method} ${req.path}: ` +
            dupSigs.map(([sig, v]) => `"${sig}" ×${v.count}`).join(', ')
        );
      }
    });

    next();
  };
}
