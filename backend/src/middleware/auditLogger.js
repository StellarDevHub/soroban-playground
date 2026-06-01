/**
 * Audit Logger Middleware
 *
 * Intercepts state-changing requests and logs them to the Indexer's audit trail.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);
const DEFAULT_INDEXER_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 2_000;
const SENSITIVE_KEYS = new Set([
  'authorization',
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
]);

function redactValue(key, value) {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => sanitizePayload(item));
  if (value && typeof value === 'object') return sanitizePayload(value);
  return value;
}

export function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  return Object.entries(payload).reduce((safe, [key, value]) => {
    safe[key] = redactValue(key, value);
    return safe;
  }, {});
}

function normalizePath(path = '') {
  return path.replace(/\/+/g, '_').replace(/^_+|_+$/g, '') || 'ROOT';
}

function getActor(req) {
  const apiKey = req.headers?.['x-api-key'];
  if (req.headers?.['x-user-id']) return req.headers['x-user-id'];
  if (apiKey) return `${String(apiKey).slice(0, 8)}...`;
  return req.ip || req.socket?.remoteAddress || 'anonymous';
}

export function buildAuditEvent(req, statusCode) {
  const path = req.originalUrl || req.path || req.url || '/';
  return {
    event_type: `${req.method}_${normalizePath(path).toUpperCase()}`,
    actor: getActor(req),
    payload: JSON.stringify({
      path,
      method: req.method,
      params: sanitizePayload(req.params || {}),
      query: sanitizePayload(req.query || {}),
      body: sanitizePayload(req.body || {}),
      status: statusCode,
    }),
  };
}

async function postAuditEvent(fetchClient, indexerUrl, auditData, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await fetchClient(`${indexerUrl.replace(/\/$/, '')}/api/audit/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(auditData),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function createAuditLogger(options = {}) {
  const {
    fetchClient = globalThis.fetch,
    indexerUrl = process.env.INDEXER_URL || DEFAULT_INDEXER_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  return (req, res, next) => {
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      return next();
    }

    if (typeof fetchClient !== 'function') {
      console.warn('Audit logger disabled: fetch is not available');
      return next();
    }

    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      const auditData = buildAuditEvent(req, res.statusCode);
      postAuditEvent(fetchClient, indexerUrl, auditData, timeoutMs).catch(
        (err) =>
          console.error('Failed to send audit log to indexer:', err.message)
      );
    });

    return next();
  };
}

export default createAuditLogger();
