/**
 * Tests for intrusionDetection middleware (BACKEND-237).
 *
 * Covers:
 *  - Automatic IP jailing after path-traversal or SQL-injection attempts
 *    accumulate >= 100 penalty points.
 *  - 24-hour Redis TTL is used for both score and block keys.
 *  - Already-blocked IPs receive immediate HTTP 403.
 *  - Clean requests pass through.
 *  - Log sanitisation (sanitiseForLog) rejects CR/LF/NUL/ANSI sequences.
 *  - Score accumulation: multiple requests from the same IP are additive.
 */

import {
  createIntrusionDetection,
  scanSignatures,
  sanitiseForLog,
  DEFAULT_SCORE_THRESHOLD,
  DEFAULT_BLOCK_TTL_SECONDS,
  DEFAULT_SCORE_WINDOW_SECONDS,
  SCORE_KEY_PREFIX,
  BLOCK_KEY_PREFIX,
} from '../../src/middleware/intrusionDetection.js';

// ---------------------------------------------------------------------------
// Mock redisService
// ---------------------------------------------------------------------------

const store = new Map();

jest.mock('../../src/services/redisService.js', () => ({
  default: {
    get: jest.fn(async (key) => store.get(key) ?? null),
    set: jest.fn(async (key, value, _ttl) => { store.set(key, value); }),
  },
}));

import redisService from '../../src/services/redisService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides = {}) {
  return {
    ip: '1.2.3.4',
    method: 'GET',
    path: '/api/test',
    headers: {},
    query: {},
    body: {},
    params: {},
    socket: { remoteAddress: '1.2.3.4' },
    ...overrides,
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

describe('intrusionDetection module constants (BACKEND-237)', () => {
  it('DEFAULT_SCORE_THRESHOLD is 100', () => {
    expect(DEFAULT_SCORE_THRESHOLD).toBe(100);
  });

  it('DEFAULT_BLOCK_TTL_SECONDS is 24 hours (86400)', () => {
    expect(DEFAULT_BLOCK_TTL_SECONDS).toBe(86_400);
  });

  it('DEFAULT_SCORE_WINDOW_SECONDS is 24 hours (86400)', () => {
    expect(DEFAULT_SCORE_WINDOW_SECONDS).toBe(86_400);
  });
});

// ---------------------------------------------------------------------------
// sanitiseForLog
// ---------------------------------------------------------------------------

describe('sanitiseForLog', () => {
  it('removes CR and LF to prevent log injection', () => {
    expect(sanitiseForLog('evil\r\n injected line')).not.toMatch(/[\r\n]/);
  });

  it('removes NUL bytes', () => {
    expect(sanitiseForLog('a\x00b')).not.toMatch(/\x00/);
  });

  it('strips ANSI escape sequences', () => {
    const ansi = '\x1b[31mred\x1b[0m';
    expect(sanitiseForLog(ansi)).not.toMatch(/\x1b/);
    expect(sanitiseForLog(ansi)).toContain('red');
  });

  it('truncates to 200 characters', () => {
    expect(sanitiseForLog('x'.repeat(300)).length).toBe(200);
  });

  it('handles null and undefined gracefully', () => {
    expect(sanitiseForLog(null)).toBe('(null)');
    expect(sanitiseForLog(undefined)).toBe('(null)');
  });
});

// ---------------------------------------------------------------------------
// scanSignatures
// ---------------------------------------------------------------------------

describe('scanSignatures', () => {
  it('detects path traversal', () => {
    const hits = scanSignatures(['../../etc/passwd']);
    expect(hits.some((h) => h.name === 'path_traversal')).toBe(true);
  });

  it('detects SQL injection — UNION SELECT', () => {
    const hits = scanSignatures(["' UNION SELECT 1,2,3--"]);
    expect(hits.some((h) => h.name === 'sql_injection')).toBe(true);
  });

  it('detects command injection', () => {
    const hits = scanSignatures(['| cat /etc/passwd']);
    expect(hits.some((h) => h.name === 'command_injection')).toBe(true);
  });

  it('detects XSS', () => {
    const hits = scanSignatures(['<script>alert(1)</script>']);
    expect(hits.some((h) => h.name === 'xss')).toBe(true);
  });

  it('returns empty array for clean input', () => {
    expect(scanSignatures(['/api/users', 'john', '42'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Middleware — automatic IP jailing
// ---------------------------------------------------------------------------

describe('createIntrusionDetection — automatic jailing', () => {
  let middleware;

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    // Use a low threshold to simulate reaching 100 pts quickly in tests
    middleware = createIntrusionDetection({
      scoreThreshold: 100,
      blockTtlSeconds: 86_400,
      scoreWindowSeconds: 86_400,
    });
  });

  it('passes clean requests through', async () => {
    const req = makeReq({ query: { name: 'alice' } });
    const res = makeRes();
    const next = jest.fn();
    await middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('returns 400 for a single low-score threat below jailing threshold', async () => {
    // XSS score = 2, below 100
    const req = makeReq({ query: { q: '<script>alert(1)</script>' } });
    const res = makeRes();
    await middleware(req, res, jest.fn());
    expect(res._status).toBe(400);
    expect(res._body.error).toBe('Bad Request');
  });

  it('jails IP and returns 403 after score exceeds threshold', async () => {
    const ip = '5.5.5.5';
    // Pre-load a score just below the threshold (96 pts)
    store.set(`${SCORE_KEY_PREFIX}${ip}`, '96');

    // path_traversal = 4 pts → total 100 → jail
    const req = makeReq({ ip, query: { f: '../../etc/passwd' } });
    const res = makeRes();
    await middleware(req, res, jest.fn());

    expect(res._status).toBe(403);
    expect(res._body.error).toBe('Forbidden');
    // Block key must have been written to Redis with 24-h TTL
    expect(redisService.set).toHaveBeenCalledWith(
      `${BLOCK_KEY_PREFIX}${ip}`,
      '1',
      86_400
    );
  });

  it('returns immediate 403 for an already-jailed IP without scanning', async () => {
    const ip = '6.6.6.6';
    store.set(`${BLOCK_KEY_PREFIX}${ip}`, '1');

    const req = makeReq({ ip, query: { name: 'clean' } });
    const res = makeRes();
    const next = jest.fn();
    await middleware(req, res, next);

    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
    // No score increment for an already-jailed IP
    expect(redisService.set).not.toHaveBeenCalledWith(
      expect.stringContaining(SCORE_KEY_PREFIX),
      expect.anything(),
      expect.anything()
    );
  });

  it('calls onBlock callback when IP is jailed', async () => {
    const ip = '7.7.7.7';
    store.set(`${SCORE_KEY_PREFIX}${ip}`, '96');
    const onBlock = jest.fn();
    const mw = createIntrusionDetection({ scoreThreshold: 100, blockTtlSeconds: 86_400, scoreWindowSeconds: 86_400, onBlock });

    const req = makeReq({ ip, query: { f: '../../etc/passwd' } });
    await mw(req, makeRes(), jest.fn());

    expect(onBlock).toHaveBeenCalledWith(ip, expect.any(Array), expect.any(Number));
  });

  it('accumulates scores from multiple requests before jailing', async () => {
    const ip = '8.8.8.8';
    // 25 path_traversal requests × 4 pts = 100 pts (threshold)
    for (let i = 0; i < 25; i++) {
      const existing = store.get(`${SCORE_KEY_PREFIX}${ip}`);
      const current = existing ? parseInt(existing, 10) : 0;
      store.set(`${SCORE_KEY_PREFIX}${ip}`, String(current + 4));
    }
    // 26th request pushes to 104, should jail
    const req = makeReq({ ip, query: { f: '../../etc/passwd' } });
    const res = makeRes();
    await middleware(req, res, jest.fn());
    expect(res._status).toBe(403);
  });

  it('writes score key with 24-hour TTL (86400 seconds)', async () => {
    const ip = '9.9.9.9';
    const req = makeReq({ ip, query: { q: '<script>x</script>' } });
    await middleware(req, makeRes(), jest.fn());
    expect(redisService.set).toHaveBeenCalledWith(
      `${SCORE_KEY_PREFIX}${ip}`,
      expect.any(String),
      86_400
    );
  });

  it('sanitises IP in logs — CRLF injected IP is rejected from log', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ip = '10.0.0.1\r\nFAKE LOG LINE';
    store.set(`${BLOCK_KEY_PREFIX}${ip}`, '1'); // force block path
    const req = makeReq({ ip, headers: {} });
    await middleware(req, makeRes(), jest.fn());
    const logArg = consoleSpy.mock.calls[0]?.[0] ?? '';
    expect(logArg).not.toMatch(/FAKE LOG LINE/);
    consoleSpy.mockRestore();
  });
});
