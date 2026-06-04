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

export function parseCorsOrigins(value) {
  const origins = [...new Set(splitList(value))];
  const allowAll = origins.length === 0 || origins.includes('*');

  return {
    allowAll,
    origins: allowAll ? [] : origins,
  };
}

export function createCorsOptions(env = process.env) {
  const { allowAll, origins } = parseCorsOrigins(
    getFirstConfiguredValue(env, ORIGIN_ENV_KEYS)
  );
  const allowCredentials = env.CORS_ALLOW_CREDENTIALS === 'true';
  const allowedHeaders = splitList(env.CORS_ALLOWED_HEADERS);
  const allowedMethods = splitList(env.CORS_ALLOWED_METHODS);
  const allowedOriginSet = new Set(origins);
  const exposedHeaders = splitList(env.CORS_EXPOSED_HEADERS);

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

  if (allowAll) {
    options.origin = allowCredentials ? true : '*';
    return options;
  }

  options.origin = (origin, callback) => {
    const isAllowed = !origin || allowedOriginSet.has(origin);
    callback(null, isAllowed);
  };

  return options;
}

export const corsOptions = createCorsOptions();
