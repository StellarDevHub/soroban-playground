// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];
const DEFAULT_MAX_AGE_SECONDS = 86400;

/**
 * Environment variable keys checked (in order) for the allowed-origins list.
 * The first key whose value is non-empty wins.
 */
const ORIGIN_ENV_KEYS = [
  'CORS_ALLOWED_ORIGINS',
  'CORS_ORIGINS',
  'ALLOWED_ORIGINS',
];

/**
 * Split a comma-separated string into a trimmed, non-empty array of values.
 *
 * @param {string|undefined} value
 * @returns {string[]}
 */
const splitList = (value) => {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

/**
 * Parse a string value as a positive integer.
 * Returns `fallback` when the value is absent, non-numeric, or non-positive.
 *
 * @param {string|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Return the first non-empty value from `env` matching any of `keys`,
 * or `undefined` if none are set.
 *
 * @param {Record<string, string|undefined>} env
 * @param {string[]} keys
 * @returns {string|undefined}
 */
const getFirstConfiguredValue = (env, keys) => {
  for (const key of keys) {
    if (env[key] && typeof env[key] === 'string' && env[key].trim()) {
      return env[key];
    }
  }
  return undefined;
};

/**
 * Compile a wildcard origin pattern (e.g. `https://*.example.com`) into a RegExp.
 * Only single-label wildcards are supported — `https://*.example.com` matches
 * `https://app.example.com` but NOT `https://deep.sub.example.com`.
 *
 * Returns `null` for patterns that contain no wildcard character.
 *
 * @param {string} pattern
 * @returns {RegExp|null}
 */
export function compileOriginPattern(pattern) {
  if (!pattern.includes('*')) return null;
  // Escape regex special chars (excluding `*`), then replace `*` with a
  // single-label wildcard that forbids dots.
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+');
  return new RegExp(`^${escaped}$`);
}

/**
 * Build an efficient origin-checking function that supports both exact origins
 * and wildcard patterns.
 *
 * Requests without an `Origin` header (server-to-server calls) are always
 * allowed.
 *
 * @param {string[]} origins
 * @returns {(origin: string|undefined) => boolean}
 */
export function buildOriginMatcher(origins) {
  const exactSet = new Set();
  const patterns = [];

  for (const origin of origins) {
    if (origin.includes('*')) {
      const re = compileOriginPattern(origin);
      if (re) patterns.push(re);
    } else {
      exactSet.add(origin);
    }
  }

  return function isAllowed(origin) {
    if (!origin) return true; // server-to-server / no Origin header
    if (exactSet.has(origin)) return true;
    return patterns.some((re) => re.test(origin));
  };
}

/**
 * Parse a comma-separated origin allowlist string into a structured result.
 * A missing value or a list that contains `*` is treated as "allow all".
 *
 * @param {string|undefined} value
 * @returns {{ allowAll: boolean, origins: string[] }}
 */
export function parseCorsOrigins(value) {
  const origins = [...new Set(splitList(value))];
  const allowAll = origins.length === 0 || origins.includes('*');

  return {
    allowAll,
    origins: allowAll ? [] : origins,
  };
}

/**
 * Build a CORS options object suitable for use with the `cors` npm package.
 *
 * Reads configuration from environment variables:
 * - `CORS_ALLOWED_ORIGINS` / `CORS_ORIGINS` / `ALLOWED_ORIGINS` — comma-separated origin allowlist
 * - `CORS_ALLOW_CREDENTIALS` — set to `"true"` to enable credentials
 * - `CORS_ALLOWED_HEADERS` — comma-separated list of allowed request headers
 * - `CORS_ALLOWED_METHODS` — comma-separated list of allowed HTTP methods
 * - `CORS_EXPOSED_HEADERS` — comma-separated list of headers to expose
 * - `CORS_MAX_AGE_SECONDS` — preflight cache duration in seconds (default: 86400)
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @param {string[]|null} [dynamicOrigins=null] Additional origins loaded at runtime (e.g. from DB whitelist).
 * @returns {import('cors').CorsOptions}
 */
export function createCorsOptions(env = process.env, dynamicOrigins = null) {
  const { allowAll, origins } = parseCorsOrigins(
    getFirstConfiguredValue(env, ORIGIN_ENV_KEYS)
  );
  const allowCredentials = env.CORS_ALLOW_CREDENTIALS === 'true';
  const allowedHeaders = splitList(env.CORS_ALLOWED_HEADERS);
  const allowedMethods = splitList(env.CORS_ALLOWED_METHODS);
  const exposedHeaders = splitList(env.CORS_EXPOSED_HEADERS);

  // Determine whether any runtime-loaded origins are present
  const hasDynamicOrigins =
    Array.isArray(dynamicOrigins) && dynamicOrigins.length > 0;

  const options = {
    credentials: allowCredentials,
    maxAge: toPositiveInt(env.CORS_MAX_AGE_SECONDS, DEFAULT_MAX_AGE_SECONDS),
    methods: allowedMethods.length > 0 ? allowedMethods : DEFAULT_METHODS,
    optionsSuccessStatus: 204,
  };

  if (allowedHeaders.length > 0) {
    options.allowedHeaders = allowedHeaders;
  }

  if (exposedHeaders.length > 0) {
    options.exposedHeaders = exposedHeaders;
  }

  // Pure wildcard with no extra dynamic origins: use the fast '*' path and
  // skip building a matcher entirely.
  if (allowAll && !hasDynamicOrigins) {
    options.origin = allowCredentials ? true : '*';
    return options;
  }

  // Merge env-configured origins with any dynamically loaded ones and build
  // the matcher once so it is reused across requests.
  const mergedOrigins = hasDynamicOrigins
    ? [...origins, ...dynamicOrigins]
    : origins;
  const isAllowed = buildOriginMatcher(mergedOrigins);

  options.origin = (origin, callback) => {
    callback(null, isAllowed(origin));
  };

  return options;
}

export const corsOptions = createCorsOptions();
