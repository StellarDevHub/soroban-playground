const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?!$)|$)){4}$/;
const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::ffff:\d{1,3}(?:\.\d{1,3}){3})$/;

export function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const normalized = normalizeIp(ip.trim());
  return IPV4_RE.test(normalized) || IPV6_RE.test(normalized);
}

export function normalizeIp(ip) {
  if (!ip) return '';
  const value = ip.trim();
  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }
  return value;
}

function parseForwardedFor(headerValue) {
  if (!headerValue) return [];
  return String(headerValue)
    .split(',')
    .map((part) => normalizeIp(part))
    .filter(isValidIp);
}

/**
 * Resolve the client IP from proxy headers when trust proxy is enabled.
 * Uses the right-most untrusted hop from X-Forwarded-For when behind proxies.
 */
export function resolveClientIp(req, options = {}) {
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY !== 'false';
  const trustProxyHops = Number.parseInt(
    options.trustProxyHops ?? process.env.TRUST_PROXY_HOPS ?? '1',
    10
  );

  const directIp = normalizeIp(
    req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  );

  if (!trustProxy) {
    return isValidIp(directIp) ? directIp : '0.0.0.0';
  }

  const forwarded = parseForwardedFor(req.headers['x-forwarded-for']);
  const cfConnectingIp = normalizeIp(req.headers['cf-connecting-ip'] || '');
  const realIp = normalizeIp(req.headers['x-real-ip'] || '');

  if (isValidIp(cfConnectingIp)) return cfConnectingIp;
  if (isValidIp(realIp)) return realIp;

  if (forwarded.length > 0) {
    const clientIndex = Math.min(
      Math.max(0, forwarded.length - trustProxyHops),
      forwarded.length - 1
    );
    const leftmostClient = forwarded[0];
    const candidate =
      trustProxyHops <= 1 ? leftmostClient : forwarded[clientIndex];
    if (isValidIp(candidate)) return candidate;
  }

  if (isValidIp(req.ip)) return normalizeIp(req.ip);
  return isValidIp(directIp) ? directIp : '0.0.0.0';
}

export function clientIpMiddleware(options = {}) {
  return (req, _res, next) => {
    req.clientIp = resolveClientIp(req, options);
    next();
  };
}

export default {
  resolveClientIp,
  clientIpMiddleware,
  isValidIp,
  normalizeIp,
};
