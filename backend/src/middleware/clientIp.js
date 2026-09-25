// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import proxyaddr from 'proxy-addr';

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?!$)|$)){4}$/;
const IPV6_RE =
  /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::1|::ffff:\d{1,3}(?:\.\d{1,3}){3})$/;

// Same ranges Express is configured to trust in server.js.
export const DEFAULT_TRUSTED_PROXIES = ['loopback', 'linklocal', 'uniquelocal'];

export function isValidIp(ip) {
  if (!ip || typeof ip !== 'string') return false;
  const normalized = normalizeIp(ip.trim());
  return IPV4_RE.test(normalized) || IPV6_RE.test(normalized);
}

export function normalizeIp(ip) {
  if (!ip) return '';
  const value = String(ip).trim();
  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }
  return value;
}

function parseTrustedProxies(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return DEFAULT_TRUSTED_PROXIES;
}

const compiledTrustCache = new Map();

function compileTrust(list) {
  const cacheKey = list.join(',');
  let trust = compiledTrustCache.get(cacheKey);
  if (!trust) {
    trust = proxyaddr.compile(list);
    compiledTrustCache.set(cacheKey, trust);
  }
  return trust;
}

/**
 * Resolve the client IP without trusting attacker-controlled headers.
 *
 * Forwarding headers are only honoured when the TCP peer is itself a trusted
 * proxy (TRUSTED_PROXIES, default loopback/linklocal/uniquelocal). The
 * X-Forwarded-For chain is then walked right-to-left, skipping trusted hops,
 * so the first untrusted address wins — a client prepending fake entries to
 * the header cannot change the result. `trustProxyHops` additionally caps how
 * many hops may be skipped.
 *
 * CF-Connecting-IP / X-Real-IP are single-value headers set by the edge; they
 * are only read when the peer is trusted.
 */
export function resolveClientIp(req, options = {}) {
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY !== 'false';
  const trustProxyHops = Number.parseInt(
    options.trustProxyHops ?? process.env.TRUST_PROXY_HOPS ?? '',
    10
  );
  const trustedProxies = parseTrustedProxies(
    options.trustedProxies ?? process.env.TRUSTED_PROXIES
  );

  const directIp = normalizeIp(
    req.socket?.remoteAddress || req.connection?.remoteAddress || ''
  );
  const fallback = isValidIp(directIp) ? directIp : '0.0.0.0';

  if (!trustProxy || !isValidIp(directIp)) {
    return fallback;
  }

  const trust = compileTrust(trustedProxies);
  if (!trust(directIp, 0)) {
    // Peer is not one of our proxies: every forwarding header is spoofable.
    return fallback;
  }

  const cfConnectingIp = normalizeIp(req.headers?.['cf-connecting-ip'] || '');
  if (isValidIp(cfConnectingIp)) return cfConnectingIp;
  const realIp = normalizeIp(req.headers?.['x-real-ip'] || '');
  if (isValidIp(realIp)) return realIp;

  const hopTrust =
    Number.isFinite(trustProxyHops) && trustProxyHops > 0
      ? (addr, i) => i < trustProxyHops && trust(addr, i)
      : trust;

  let resolved;
  try {
    resolved = proxyaddr(
      {
        headers: req.headers || {},
        connection: { remoteAddress: directIp },
      },
      hopTrust
    );
  } catch {
    return fallback;
  }

  const candidate = normalizeIp(resolved);
  return isValidIp(candidate) ? candidate : fallback;
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
  DEFAULT_TRUSTED_PROXIES,
};
