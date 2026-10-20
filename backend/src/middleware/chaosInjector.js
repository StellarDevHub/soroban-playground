import logger, { getCurrentTraceId } from '../utils/logger.js';

/**
 * Chaos engineering fault injection middleware (Issue #1770).
 *
 * Lets developers inject latency, dropped connections, HTTP 5xx errors and
 * simulated Stellar RPC timeouts per request via headers, for resilience and
 * retry testing:
 *
 *   X-Chaos-Latency: 500ms     delay before handling (also "1.5s" or "500")
 *   X-Chaos-Jitter: 200ms      extra random delay of up to this much
 *   X-Chaos-Drop-Rate: 0.1     probability the connection is dropped
 *   X-Chaos-Error-Rate: 0.2    probability of an injected 5xx response
 *   X-Chaos-Error-Status: 503  500, 503 or 504 (default 503)
 *   X-Chaos-Rpc-Timeout: 0.5   probability of a simulated RPC timeout (504)
 *
 * Production guard: the middleware is a no-op unless CHAOS_ENABLED=true and
 * neither NODE_ENV nor APP_ENV is "production". Production wins over the flag.
 */

export const MAX_CHAOS_LATENCY_MS = 30_000;
const ALLOWED_ERROR_STATUSES = new Set([500, 503, 504]);

export function isChaosAllowed(env = process.env) {
  const isProduction = [env.NODE_ENV, env.APP_ENV].some(
    (value) => (value || '').toLowerCase() === 'production'
  );
  return !isProduction && (env.CHAOS_ENABLED || '').toLowerCase() === 'true';
}

/** Parses "500ms", "1.5s" or "500" into clamped milliseconds; 0 if invalid. */
export function parseDuration(raw) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s)?\s*$/i.exec(raw ?? '');
  if (!match) return 0;
  const ms = Number(match[1]) * (match[2]?.toLowerCase() === 's' ? 1000 : 1);
  return Math.min(ms, MAX_CHAOS_LATENCY_MS);
}

/** Parses a probability in [0, 1]; out-of-range or invalid values become 0. */
export function parseRate(raw) {
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
}

export function parseChaosHeaders(headers = {}) {
  const status = Number(headers['x-chaos-error-status']);
  return {
    latencyMs: parseDuration(headers['x-chaos-latency']),
    jitterMs: parseDuration(headers['x-chaos-jitter']),
    dropRate: parseRate(headers['x-chaos-drop-rate']),
    errorRate: parseRate(headers['x-chaos-error-rate']),
    errorStatus: ALLOWED_ERROR_STATUSES.has(status) ? status : 503,
    rpcTimeoutRate: parseRate(headers['x-chaos-rpc-timeout']),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createChaosInjector({
  env = process.env,
  random = Math.random,
  delay = sleep,
  log = logger,
} = {}) {
  return async function chaosInjector(req, res, next) {
    if (!isChaosAllowed(env)) return next();

    const rules = parseChaosHeaders(req.headers);
    const record = (fault, extra = {}) => {
      log.warn('chaos fault injected', {
        chaos: true,
        fault,
        traceId: getCurrentTraceId(),
        method: req.method,
        path: req.originalUrl || req.url,
        ...extra,
      });
      res.setHeader?.('X-Chaos-Injected', fault);
    };

    const latency = rules.latencyMs + random() * rules.jitterMs;
    if (latency > 0) {
      record('latency', { latencyMs: Math.round(latency) });
      await delay(latency);
    }

    if (rules.dropRate > 0 && random() < rules.dropRate) {
      record('drop');
      return req.socket?.destroy();
    }

    if (rules.rpcTimeoutRate > 0 && random() < rules.rpcTimeoutRate) {
      record('rpc_timeout', { status: 504 });
      return res.status(504).json({
        error: 'Stellar RPC request timed out (chaos injected)',
        code: 'STELLAR_RPC_TIMEOUT',
        chaos: true,
      });
    }

    if (rules.errorRate > 0 && random() < rules.errorRate) {
      record('http_error', { status: rules.errorStatus });
      return res.status(rules.errorStatus).json({
        error: 'Injected chaos failure',
        code: 'CHAOS_INJECTED',
        chaos: true,
      });
    }

    return next();
  };
}

export const chaosInjector = createChaosInjector();
