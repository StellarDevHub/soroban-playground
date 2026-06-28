// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

const DEFAULT_METHODS = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];
const DEFAULT_MAX_AGE_SECONDS = 86400;

const ORIGIN_ENV_KEYS = [
  'CORS_ALLOWED_ORIGINS',
  'CORS_ORIGINS',
  'ALLOWED_ORIGINS',
];

const splitList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getFirstConfiguredValue = (env, keys) => {
  for (const key of keys) {
    if (env[key]) return env[key];
  }
  return undefined;
};

// Convert a wildcard pattern like *.example.com or https://*.example.com to a RegExp.
// Only a single-label wildcard is supported (e.g. *.example.com matches
// app.example.com but NOT deep.sub.example.com).
export function compileOriginPattern(pattern) {
  if (!pattern.includes('*')) return null;
  // Escape all regex special chars first (leaves * untouched since it isn't one),
  // then replace each * with a single-label wildcard pattern.
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[^.]+');
  return new RegExp(`^${escaped}$`);
}

// Build a fast origin-checking function that handles exact matches and wildcard patterns.
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

export function parseCorsOrigins(value) {
  const origins = [...new Set(splitList(value))];
  const allowAll = origins.length === 0 || origins.includes('*');

  return {
    allowAll,
    origins: allowAll ? [] : origins,
  };
}

// dynamicOrigins: additional origins loaded at runtime (e.g. from the DB whitelist).
export function createCorsOptions(env = process.env, dynamicOrigins = null) {
  const { allowAll, origins } = parseCorsOrigins(
    getFirstConfiguredValue(env, ORIGIN_ENV_KEYS)
  );
  const allowCredentials = env.CORS_ALLOW_CREDENTIALS === 'true';
  const allowedHeaders = splitList(env.CORS_ALLOWED_HEADERS);
  const allowedMethods = splitList(env.CORS_ALLOWED_METHODS);
  const exposedHeaders = splitList(env.CORS_EXPOSED_HEADERS);

  // Merge env-configured origins with any dynamically loaded ones
  const mergedOrigins =
    dynamicOrigins && dynamicOrigins.length
      ? [...origins, ...dynamicOrigins]
      : origins;
  const isAllowed = buildOriginMatcher(mergedOrigins);

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

  // Pure wildcard with no extra dynamic origins keeps the fast '*' path
  if (allowAll && !(dynamicOrigins && dynamicOrigins.length)) {
    options.origin = allowCredentials ? true : '*';
    return options;
  }

  options.origin = (origin, callback) => {
    callback(null, isAllowed(origin));
  };

  return options;
}

export const corsOptions = createCorsOptions();
