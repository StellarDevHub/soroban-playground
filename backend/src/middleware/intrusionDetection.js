// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import redisService from '../services/redisService.js';

const SCORE_KEY_PREFIX = 'ids:score:';
const BLOCK_KEY_PREFIX = 'ids:block:';
const DEFAULT_BLOCK_TTL_SECONDS = 900; // 15 minutes
const DEFAULT_SCORE_WINDOW_SECONDS = 300; // 5 minutes
const DEFAULT_SCORE_THRESHOLD = 10;

const SIGNATURES = [
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

function scanSignatures(inputs) {
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

function getClientIp(req) {
  return (
    req.ip ||
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

async function isBlocked(ip) {
  try {
    const val = await redisService.get(`${BLOCK_KEY_PREFIX}${ip}`);
    return val !== null;
  } catch {
    return false;
  }
}

async function blockIp(ip, ttl) {
  try {
    await redisService.set(`${BLOCK_KEY_PREFIX}${ip}`, '1', ttl);
  } catch {
    // non-fatal
  }
}

async function addScore(ip, points, windowSeconds) {
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

export function createIntrusionDetection(options = {}) {
  const {
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
    blockTtlSeconds = DEFAULT_BLOCK_TTL_SECONDS,
    scoreWindowSeconds = DEFAULT_SCORE_WINDOW_SECONDS,
    onBlock = null,
  } = options;

  return async (req, res, next) => {
    const ip = getClientIp(req);

    if (await isBlocked(ip)) {
      console.warn(`[IDS] Blocked request from ${ip}: ${req.method} ${req.path}`);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your IP has been temporarily blocked due to suspicious activity.',
      });
    }

    const inputs = extractInputStrings(req);
    if (!inputs.length) return next();

    const hits = scanSignatures(inputs);
    if (!hits.length) return next();

    const totalScore = hits.reduce((s, h) => s + h.score, 0);
    const currentScore = await addScore(ip, totalScore, scoreWindowSeconds);

    console.warn(
      `[IDS] Threat detected from ${ip}: ${hits.map((h) => h.name).join(', ')} | score=${currentScore}/${scoreThreshold}`
    );

    if (currentScore >= scoreThreshold) {
      await blockIp(ip, blockTtlSeconds);
      if (typeof onBlock === 'function') onBlock(ip, hits, currentScore);
      console.error(`[IDS] IP banned: ${ip} (score=${currentScore})`);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your IP has been temporarily blocked due to suspicious activity.',
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
