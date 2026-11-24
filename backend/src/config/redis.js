import { isIP } from 'node:net';

// Validate before opening sockets; diagnostics must never include credentials.
function boolean(env, name, fallback = false) {
  if (env[name] === undefined || env[name] === '') return fallback;
  if (env[name] === 'true') return true;
  if (env[name] === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function endpoints(value, name, defaultPort) {
  if (!value) return [];
  return value.split(',').map((entry) => {
    const match = entry
      .trim()
      .match(/^(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9._-]+)(?::(\d+))?$/);
    const port = Number(match?.[2] ?? defaultPort);
    const host = match?.[1].replace(/^\[|\]$/g, '');
    if (
      !match ||
      (match[1].startsWith('[') && isIP(host) !== 6) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error(
        `${name} must contain comma-separated host:port endpoints`
      );
    }
    return { host, port };
  });
}

export function redisConfig(env = process.env) {
  const nodes = endpoints(env.REDIS_CLUSTER_NODES, 'REDIS_CLUSTER_NODES', 6379);
  const sentinels = endpoints(
    env.REDIS_SENTINEL_NODES,
    'REDIS_SENTINEL_NODES',
    26379
  );
  if (nodes.length && sentinels.length) {
    throw new Error(
      'Configure either REDIS_CLUSTER_NODES or REDIS_SENTINEL_NODES'
    );
  }
  if (sentinels.length && !env.REDIS_SENTINEL_NAME?.trim()) {
    throw new Error('REDIS_SENTINEL_NAME is required with Sentinel nodes');
  }
  let url;
  try {
    url = new URL(env.REDIS_URL || 'redis://localhost:6379');
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      !url.hostname ||
      (url.port && (Number(url.port) < 1 || Number(url.port) > 65535)) ||
      !/^\/\d*$/.test(url.pathname || '/') ||
      url.search ||
      url.hash
    )
      throw new Error();
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    throw new Error(
      'REDIS_URL must be a redis:// or rediss:// URL with an optional numeric database'
    );
  }
  const db = Number(url.pathname.slice(1) || 0);
  if (!Number.isSafeInteger(db) || (nodes.length && db !== 0)) {
    throw new Error(
      'REDIS_URL database must be a nonnegative integer (0 for Cluster)'
    );
  }
  const tls = boolean(env, 'REDIS_TLS') || url.protocol === 'rediss:';
  const rejectUnauthorized = boolean(
    env,
    'REDIS_TLS_REJECT_UNAUTHORIZED',
    true
  );
  return {
    url: url.toString(),
    nodes,
    sentinels,
    name: env.REDIS_SENTINEL_NAME?.trim(),
    enabled:
      !!env.REDIS_URL ||
      nodes.length > 0 ||
      sentinels.length > 0 ||
      env.NODE_ENV !== 'production',
    options: {
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      db,
      ...(tls ? { tls: { rejectUnauthorized } } : {}),
    },
    sentinelOptions: {
      sentinelUsername: env.REDIS_SENTINEL_USERNAME || undefined,
      sentinelPassword: env.REDIS_SENTINEL_PASSWORD || undefined,
      enableTLSForSentinelMode: boolean(env, 'REDIS_SENTINEL_TLS'),
    },
  };
}

// Equal jitter retains randomness even after reaching the 30-second cap.
export function reconnectDelay(attempt, random = Math.random) {
  const cap = Math.min(
    1000 * 2 ** Math.min(Math.max(attempt - 1, 0), 5),
    30000
  );
  return Math.floor(cap / 2 + (random() * cap) / 2);
}
