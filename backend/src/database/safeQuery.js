const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const UNSAFE_SQL_PATTERNS = [
  /(\bOR\b|\bAND\b)\s+['"]?\d+['"]?\s*=\s*['"]?\d+/i,
  /;\s*DROP\b/i,
  /UNION\s+SELECT/i,
  /--/,
  /\/\*/,
];

export function assertSafeIdentifier(value, label = 'identifier') {
  if (typeof value !== 'string' || !SAFE_IDENTIFIER.test(value)) {
    throw new Error(`Unsafe SQL ${label}: ${value}`);
  }
  return value;
}

export function resolveMappedSort(sortKey, mapping, fallbackKey = 'relevance') {
  if (!mapping || typeof mapping !== 'object') {
    throw new Error('Sort mapping is required');
  }
  const key = Object.prototype.hasOwnProperty.call(mapping, sortKey)
    ? sortKey
    : fallbackKey;
  return mapping[key];
}

export function sanitizePositiveInteger(
  value,
  { min = 1, max = 365, fallback = 30 } = {}
) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function cutoffTimestampDaysAgo(days, now = Date.now()) {
  const safeDays = sanitizePositiveInteger(days);
  return new Date(now - safeDays * 86_400_000).toISOString();
}

export function validateParameterizedQuery(sql, params = []) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('SQL must be a non-empty string');
  }
  if (!Array.isArray(params)) {
    throw new Error('SQL parameters must be an array');
  }

  for (const pattern of UNSAFE_SQL_PATTERNS) {
    if (pattern.test(sql)) {
      throw new Error('Potentially unsafe SQL pattern detected');
    }
  }

  const placeholderCount = (sql.match(/\?/g) || []).length;
  if (placeholderCount !== params.length) {
    throw new Error(
      `Parameter count mismatch: expected ${placeholderCount}, received ${params.length}`
    );
  }

  return { sql, params };
}

export function wrapPreparedDatabase(db) {
  if (!db || db.__preparedGuard) return db;

  const guarded = Object.create(db);
  guarded.__preparedGuard = true;

  for (const method of ['all', 'get', 'run']) {
    if (typeof db[method] !== 'function') continue;
    guarded[method] = async function guardedQuery(sql, params = []) {
      validateParameterizedQuery(sql, params);
      return db[method](sql, params);
    };
  }

  return guarded;
}

export default {
  assertSafeIdentifier,
  resolveMappedSort,
  sanitizePositiveInteger,
  cutoffTimestampDaysAgo,
  validateParameterizedQuery,
  wrapPreparedDatabase,
};
