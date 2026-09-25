import {
  rateLimiter,
  rateLimitMiddleware,
  clearApiKeyCache,
  resolveRateLimitIdentity,
  TIER_MULTIPLIERS,
} from '../src/middleware/rateLimiter.js';

jest.mock('../src/utils/tracing.js', () => ({
  __esModule: true,
  createSpan: jest.fn(() => ({ end: jest.fn() })),
  setSpanAttributes: jest.fn(),
  addSpanEvent: jest.fn(),
  getTraceId: jest.fn(() => 'test-trace-id'),
}));

jest.mock('../src/utils/alerting.js', () => ({
  __esModule: true,
  alertManager: { alert: jest.fn() },
}));

jest.mock('../src/services/redisService.js', () => ({
  __esModule: true,
  default: { logAnalytics: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../src/services/rateLimitStrategies.js', () => ({
  __esModule: true,
  getStrategy: jest.fn().mockReturnValue({
    getName: jest.fn().mockReturnValue('SlidingWindowCounter'),
    check: jest.fn(),
  }),
}));

jest.mock('../src/config/index.js', () => ({
  __esModule: true,
  default: {
    rateLimit: {
      global: { max: 100, windowMs: 60000 },
      compile: { max: 10, windowMs: 60000 },
      invoke: { max: 30, windowMs: 60000 },
      authenticated: { max: 300, windowMs: 60000 },
    },
    tracing: { serviceName: 'test', serviceVersion: '0.0.0', enabled: false },
  },
}));

function strategy() {
  return require('../src/services/rateLimitStrategies.js').getStrategy();
}

function makeReqRes(overrides = {}) {
  const req = {
    ip: '127.0.0.1',
    headers: {},
    originalUrl: '/test',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  };
  const res = {
    _headers: {},
    set(keyOrObj, value) {
      if (typeof keyOrObj === 'object') {
        Object.assign(this._headers, keyOrObj);
      } else {
        this._headers[keyOrObj] = value;
      }
    },
    status() {
      return this;
    },
    json() {},
  };
  return { req, res };
}

beforeEach(() => {
  clearApiKeyCache();
  strategy().check.mockReset();
  require('../src/services/redisService.js').default.logAnalytics.mockResolvedValue(
    undefined
  );
});

describe('rateLimiter middleware', () => {
  it('calls next() when request is allowed', async () => {
    strategy().check.mockResolvedValue({
      allowed: true,
      current: 1,
      retryAfter: 0,
    });
    const { req, res } = makeReqRes();
    const next = jest.fn();

    await rateLimiter()(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res._headers['X-RateLimit-Limit']).toBe(100);
    expect(res._headers['X-RateLimit-Remaining']).toBe(99);
  });

  it('calls next(error) with 429 when limit exceeded', async () => {
    strategy().check.mockResolvedValue({
      allowed: false,
      current: 101,
      retryAfter: 30,
    });
    const { req, res } = makeReqRes();
    const next = jest.fn();

    await rateLimiter({ limit: 100, windowMs: 60000 })(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 429 })
    );
    expect(res._headers['Retry-After']).toBe('30');
  });

  it('fails open when redis throws', async () => {
    strategy().check.mockRejectedValue(new Error('Redis down'));
    const { req, res } = makeReqRes();
    const next = jest.fn();

    await rateLimiter()(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('uses x-forwarded-for when req.ip is absent', async () => {
    strategy().check.mockResolvedValue({
      allowed: true,
      current: 1,
      retryAfter: 0,
    });
    const { req, res } = makeReqRes({
      ip: undefined,
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    const next = jest.fn();

    await rateLimiter()(req, res, next);

    expect(strategy().check).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('10.0.0.1'),
      expect.any(Number),
      expect.any(Number)
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('uses the verified api key id as identifier when identifier=apiKey', async () => {
    strategy().check.mockResolvedValue({
      allowed: true,
      current: 1,
      retryAfter: 0,
    });
    const { req, res } = makeReqRes({ headers: { 'x-api-key': 'my-key' } });
    const next = jest.fn();
    const validateApiKey = jest
      .fn()
      .mockResolvedValue({ id: 42, tier: 'free' });

    await rateLimiter({ identifier: 'apiKey', validateApiKey })(req, res, next);

    expect(validateApiKey).toHaveBeenCalledWith('my-key');
    const key = strategy().check.mock.calls[0][1];
    expect(key).toContain('key:42');
    // The raw secret must never be written into Redis keys.
    expect(key).not.toContain('my-key');
  });

  it('uses endpoint composite key when identifier=endpoint', async () => {
    strategy().check.mockResolvedValue({
      allowed: true,
      current: 1,
      retryAfter: 0,
    });
    const { req, res } = makeReqRes({
      originalUrl: '/compile?cache=bust',
      socket: { remoteAddress: '1.2.3.4' },
    });
    const next = jest.fn();

    await rateLimiter({ identifier: 'endpoint' })(req, res, next);

    expect(strategy().check).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('1.2.3.4:/compile'),
      expect.any(Number),
      expect.any(Number)
    );
    // Query strings must not mint fresh buckets.
    expect(strategy().check.mock.calls[0][1]).not.toContain('cache=bust');
  });

  it('sets Retry-After from windowMs when retryAfter is 0', async () => {
    strategy().check.mockResolvedValue({
      allowed: false,
      current: 5,
      retryAfter: 0,
    });
    const { req, res } = makeReqRes();
    const next = jest.fn();

    await rateLimiter({ limit: 5, windowMs: 30000 })(req, res, next);

    expect(res._headers['Retry-After']).toBe('30');
  });
});

describe('rateLimitMiddleware factory', () => {
  it('returns middleware for a known config key', () => {
    expect(typeof rateLimitMiddleware('compile')).toBe('function');
  });

  it('falls back to global config for unknown key', () => {
    expect(typeof rateLimitMiddleware('unknown')).toBe('function');
  });

  it('throws when neither key nor global config exists', () => {
    const config = require('../src/config/index.js').default;
    const original = config.rateLimit.global;
    delete config.rateLimit.global;

    expect(() => rateLimitMiddleware('nonexistent')).toThrow(/not found/);

    config.rateLimit.global = original;
  });
});

describe('rate limit strategies', () => {
  it('getStrategy returns SlidingWindowCounter by default', () => {
    const { getStrategy: real } = jest.requireActual(
      '../src/services/rateLimitStrategies.js'
    );
    expect(real('unknown').getName()).toBe('SlidingWindowCounter');
  });

  it('getStrategy returns FixedWindow for FixedWindow', () => {
    const { getStrategy: real } = jest.requireActual(
      '../src/services/rateLimitStrategies.js'
    );
    expect(real('FixedWindow').getName()).toBe('FixedWindow');
  });

  it('getStrategy returns SlidingWindowLog for SlidingWindowLog', () => {
    const { getStrategy: real } = jest.requireActual(
      '../src/services/rateLimitStrategies.js'
    );
    expect(real('SlidingWindowLog').getName()).toBe('SlidingWindowLog');
  });
});

function allowAll() {
  strategy().check.mockResolvedValue({
    allowed: true,
    current: 1,
    retryAfter: 0,
  });
}

describe('rate limit identity & spoofing defence (#1574)', () => {
  it('ignores spoofed X-Forwarded-For from an untrusted peer', async () => {
    allowAll();
    const { req, res } = makeReqRes({
      ip: undefined,
      headers: { 'x-forwarded-for': '198.51.100.1' },
      socket: { remoteAddress: '203.0.113.9' },
    });

    await rateLimiter()(req, res, jest.fn());

    const key = strategy().check.mock.calls[0][1];
    expect(key).toContain('ip:203.0.113.9');
    expect(key).not.toContain('198.51.100.1');
  });

  it('rotating random X-Forwarded-For values from an untrusted peer share one bucket', async () => {
    allowAll();
    for (const spoof of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      const { req, res } = makeReqRes({
        headers: { 'x-forwarded-for': spoof },
        socket: { remoteAddress: '203.0.113.9' },
      });
      await rateLimiter()(req, res, jest.fn());
    }
    const keys = new Set(strategy().check.mock.calls.map((c) => c[1]));
    expect(keys.size).toBe(1);
  });

  it('unverified api keys fall back to the IP bucket with anonymous quota', async () => {
    allowAll();
    const validateApiKey = jest.fn().mockResolvedValue(null);
    const keys = [];
    for (const fake of ['fake-1', 'fake-2']) {
      const { req, res } = makeReqRes({
        headers: { 'x-api-key': fake },
        socket: { remoteAddress: '203.0.113.9' },
      });
      await rateLimiter({ limit: 10, validateApiKey })(req, res, jest.fn());
      keys.push(strategy().check.mock.calls.at(-1)[1]);
      expect(res._headers['X-RateLimit-Limit']).toBe(10);
    }
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toContain('ip:203.0.113.9');
  });

  it('applies tier multipliers for verified keys', async () => {
    allowAll();
    const validateApiKey = jest
      .fn()
      .mockResolvedValue({ id: 7, tier: 'premium' });
    const { req, res } = makeReqRes({ headers: { 'x-api-key': 'real' } });

    await rateLimiter({ limit: 10, validateApiKey })(req, res, jest.fn());

    expect(res._headers['X-RateLimit-Limit']).toBe(
      10 * TIER_MULTIPLIERS.premium
    );
    expect(req.rateLimit).toMatchObject({ tier: 'premium' });
  });

  it('caches api key validation results', async () => {
    allowAll();
    const validateApiKey = jest.fn().mockResolvedValue(null);
    for (let i = 0; i < 3; i += 1) {
      const { req, res } = makeReqRes({ headers: { 'x-api-key': 'same' } });
      await rateLimiter({ validateApiKey })(req, res, jest.fn());
    }
    expect(validateApiKey).toHaveBeenCalledTimes(1);
  });

  it('treats api key lookup failures as unverified instead of failing', async () => {
    allowAll();
    const validateApiKey = jest.fn().mockRejectedValue(new Error('db down'));
    const identity = await resolveRateLimitIdentity(
      {
        headers: { 'x-api-key': 'k' },
        socket: { remoteAddress: '127.0.0.1' },
      },
      { validateApiKey }
    );
    expect(identity).toMatchObject({ tier: 'anonymous', verified: false });
  });

  it('ignores oversized api key headers without looking them up', async () => {
    const validateApiKey = jest.fn();
    const identity = await resolveRateLimitIdentity(
      {
        headers: { 'x-api-key': 'x'.repeat(1000) },
        socket: { remoteAddress: '127.0.0.1' },
      },
      { validateApiKey }
    );
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(identity.verified).toBe(false);
  });
});

describe('rateLimitMiddleware scoping (#1574)', () => {
  it('global and route limiters never share a bucket', async () => {
    allowAll();
    const { req, res } = makeReqRes();
    await rateLimitMiddleware('global')(req, res, jest.fn());
    await rateLimitMiddleware('compile')(req, res, jest.fn());
    await rateLimitMiddleware('invoke')(req, res, jest.fn());

    const keys = strategy().check.mock.calls.map((c) => c[1]);
    expect(keys[0]).toContain('ratelimit:global:');
    expect(keys[1]).toContain('ratelimit:compile:');
    expect(keys[2]).toContain('ratelimit:invoke:');
  });

  it('uses the configured route limit instead of a hardcoded value', async () => {
    allowAll();
    const { req, res } = makeReqRes();
    await rateLimitMiddleware('compile')(req, res, jest.fn());
    expect(res._headers['X-RateLimit-Limit']).toBe(10);
  });

  it('only grants the authenticated global quota to verified callers', async () => {
    allowAll();
    const spoofed = makeReqRes({ headers: { authorization: 'Bearer junk' } });
    await rateLimitMiddleware('global', {
      validateApiKey: jest.fn().mockResolvedValue(null),
    })(spoofed.req, spoofed.res, jest.fn());
    expect(spoofed.res._headers['X-RateLimit-Limit']).toBe(100);

    const verified = makeReqRes({ headers: { 'x-api-key': 'good' } });
    await rateLimitMiddleware('global', {
      validateApiKey: jest.fn().mockResolvedValue({ id: 1, tier: 'standard' }),
    })(verified.req, verified.res, jest.fn());
    // authenticated.max, without an extra tier multiplier on the global bucket
    expect(verified.res._headers['X-RateLimit-Limit']).toBe(300);
  });
});
