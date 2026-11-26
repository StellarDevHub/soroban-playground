// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// BACKEND-237: Intrusion Detection Middleware with Redis-backed distributed IP jailing.
//
// Key properties:
// - Penalty scores are stored in Redis with a 24-hour sliding decay window so that
//   distributed cluster instances share a consistent view of attacker state.
// - IPs that accumulate > SCORE_THRESHOLD (100) penalty points are automatically
//   jailed: a Redis BLOCK key is set and all subsequent requests return HTTP 403.
// - All log output is sanitised to prevent log-injection via attacker-controlled
//   strings (IP, path, user-agent) being embedded into log lines.

import redisService from '../services/redisService.js';

export const SCORE_KEY_PREFIX = 'ids:score:';
export const BLOCK_KEY_PREFIX = 'ids:block:';

// 24-hour decay window so an attacker cannot reset by waiting a few minutes.
export const DEFAULT_BLOCK_TTL_SECONDS = 86_400;    // 24 h
export const DEFAULT_SCORE_WINDOW_SECONDS = 86_400;  // 24 h

// Automatic jailing threshold: 100 penalty points (BACKEND-237).
export const DEFAULT_SCORE_THRESHOLD = 100;

export const SIGNATURES = [
  {
    name: 'sql_injection',
    score: 3,
    patterns: [
      /(\bSELECT\b.*\bFROM\b|\bINSERT\b.*\bINTO\b|\bUPDATE\b.*\bSET\b|\bDELETE\b.*\bFROM\b|\bDROP\b.*\bTABLE\b)/i,
      /('|")\s*(?:OR|AND)\s+(?:'|")?[\w\s]*(?:'|")?\s*=\s*(?:'|")?[\w\s]*(?:'|")?/i,
      /;\s*(?:DROP|DELETE|INSERT|UPDATE|EXEC|EXECUTE)\b/i,
      /\bUNION\b.*\bSELECT\b/i,
      /--\s|\/\*.*\*\//,
    ],
  },
  {
    name: 'path_traversal',
    score: 4,
    patterns: [
      /\.\.[/\\]/,
      /%2e%2e[%2f%5c]/i,
      /\.\.%[2f5c]/i,
      /%252e%252e/i,
      /\/etc\/passwd|\/etc\/shadow|\/proc\/self/i,
      /[/\\](windows|winnt)[/\\]system32/i,
    ],
  },
  {
    name: 'xss',
    score: 2,
    patterns: [
      /<script[\s>]/i,
      /javascript\s*:/i,
      /on(?:load|error|click|mouse|key|focus|blur|change|submit)\s*=/i,
      /<iframe|<object|<embed|<applet/i,
      /document\.(cookie|location|write)/i,
    ],
  },
  {
    name: 'command_injection',
    score: 5,
    patterns: [
      /[;&|`$].*(?:cat|ls|whoami|id|uname|wget|curl|bash|sh|nc|python|perl|ruby)\b/i,
      /\$\(.*\)|`[^`]+`/,
      /\|\s*(?:cat|bash|sh|nc|python|perl)\b/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// Log sanitisation helpers (BACKEND-237)
// ---------------------------------------------------------------------------

/**
 * Remove characters that can break log lines or be used for log-injection:
 * CR, LF, NUL, and ANSI escape sequences.  Truncates to 200 characters so
 * an oversized string cannot flood the log sink.
 *
 * @param {unknown} value - Untrusted value to sanitise.
 * @returns {string} Safe string safe for embedding in a log line.
 */
export function sanitiseForLog(value) {
  if (value === null || value === undefined) return '(null)';
  return String(value)
    .replace(/[\r\n\x00]/g, '_')
    // Strip ANSI escape sequences to prevent terminal hijacking via logs
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .slice(0, 200);
}

// ---------------------------------------------------------------------------
// Request input extraction
// ---------------------------------------------------------------------------

function extractInputStrings(req) {
  const parts = [];
  const push = (v) => {
    if (typeof v === 'string') parts.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(push);
  };
  push(req.query);
  push(req.body);
  push(req.params);
  push(req.path);
  return parts;
}

// ---------------------------------------------------------------------------
// Signature scanning
// ---------------------------------------------------------------------------

export function scanSignatures(inputs) {
  const matches = [];
  for (const sig of SIGNATURES) {
    for (const pattern of sig.patterns) {
      if (inputs.some((s) => pattern.test(s))) {
        matches.push({ name: sig.name, score: sig.score });
        break;
      }
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// IP helpers
// ---------------------------------------------------------------------------

export function getClientIp(req) {
  return (
    req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Redis operations (distributed, 24-hour decay)
// ---------------------------------------------------------------------------

export async function isBlocked(ip) {
  try {
    const val = await redisService.get(`${BLOCK_KEY_PREFIX}${ip}`);
    return val !== null;
  } catch {
    return false;
  }
}

export async function blockIp(ip, ttl) {
  try {
    await redisService.set(`${BLOCK_KEY_PREFIX}${ip}`, '1', ttl);
  } catch {
    // non-fatal: fail open to avoid blocking legitimate traffic on Redis outage
  }
}

export async function addScore(ip, points, windowSeconds) {
  const key = `${SCORE_KEY_PREFIX}${ip}`;
  try {
    const raw = await redisService.get(key);
    const current = raw ? parseInt(raw, 10) : 0;
    const next = current + points;
    await redisService.set(key, String(next), windowSeconds);
    return next;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function createIntrusionDetection(options = {}) {
  const {
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
    blockTtlSeconds = DEFAULT_BLOCK_TTL_SECONDS,
    scoreWindowSeconds = DEFAULT_SCORE_WINDOW_SECONDS,
    onBlock = null,
  } = options;

  return async (req, res, next) => {
    const ip = getClientIp(req);
    const safeIp = sanitiseForLog(ip);

    if (await isBlocked(ip)) {
      // Sanitise path before embedding in log to prevent log-injection
      console.warn(
        `[IDS] Blocked request from ${safeIp}: ${req.method} ${sanitiseForLog(req.path)}`
      );
      return res.status(403).json({
        error: 'Forbidden',
        message:
          'Your IP has been temporarily blocked due to suspicious activity.',
      });
    }

    const inputs = extractInputStrings(req);
    if (!inputs.length) return next();

    const hits = scanSignatures(inputs);
    if (!hits.length) return next();

    const totalScore = hits.reduce((s, h) => s + h.score, 0);
    const currentScore = await addScore(ip, totalScore, scoreWindowSeconds);

    // Sanitise attacker-controlled strings before writing to logs (BACKEND-237)
    console.warn(
      `[IDS] Threat detected from ${safeIp}: ${hits.map((h) => h.name).join(', ')} | score=${currentScore}/${scoreThreshold}`
    );

    if (currentScore >= scoreThreshold) {
      await blockIp(ip, blockTtlSeconds);
      if (typeof onBlock === 'function') onBlock(ip, hits, currentScore);
      console.error(`[IDS] IP jailed: ${safeIp} (score=${currentScore})`);
      return res.status(403).json({
        error: 'Forbidden',
        message:
          'Your IP has been temporarily blocked due to suspicious activity.',
      });
    }

    return res.status(400).json({
      error: 'Bad Request',
      message: 'Malicious input detected.',
      threats: hits.map((h) => h.name),
    });
  };
}

export default createIntrusionDetection();
