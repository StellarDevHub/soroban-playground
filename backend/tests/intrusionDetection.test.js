import { createIntrusionDetection } from '../src/middleware/intrusionDetection.js';

jest.mock('../src/services/redisService.js', () => {
  const store = new Map();
  return {
    __esModule: true,
    default: {
      get: jest.fn(async (k) => store.get(k) ?? null),
      set: jest.fn(async (k, v) => { store.set(k, v); return 'OK'; }),
      _store: store,
      _reset: () => store.clear(),
    },
  };
});

function makeReq(overrides = {}) {
  return {
    ip: '10.0.0.1',
    method: 'POST',
    path: '/api/test',
    headers: {},
    query: {},
    body: {},
    params: {},
    ...overrides,
  };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = jest.fn((s) => { res._status = s; return res; });
  res.json = jest.fn((b) => { res._body = b; return res; });
  return res;
}

let redisService;
beforeEach(async () => {
  const m = await import('../src/services/redisService.js');
  redisService = m.default;
  redisService._reset();
  jest.clearAllMocks();
});

describe('createIntrusionDetection', () => {
  describe('clean requests', () => {
    it('calls next() for normal requests', async () => {
      const mw = createIntrusionDetection();
      const next = jest.fn();
      await mw(makeReq({ body: { name: 'hello' } }), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('calls next() for empty body', async () => {
      const mw = createIntrusionDetection();
      const next = jest.fn();
      await mw(makeReq(), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('SQL injection detection', () => {
    it('blocks UNION SELECT attacks', async () => {
      const mw = createIntrusionDetection({ scoreThreshold: 100 });
      const res = makeRes();
      await mw(makeReq({ ip: '10.1.0.1', body: { q: "1 UNION SELECT * FROM users" } }), res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.threats).toContain('sql_injection');
    });

    it('blocks DROP TABLE injections', async () => {
      const mw = createIntrusionDetection({ scoreThreshold: 100 });
      const res = makeRes();
      await mw(makeReq({ ip: '10.1.0.2', query: { id: "1; DROP TABLE users" } }), res, jest.fn());
      expect(res._status).toBe(400);
    });
  });

  describe('path traversal detection', () => {
    it('blocks ../ traversal in path', async () => {
      const mw = createIntrusionDetection({ scoreThreshold: 100 });
      const res = makeRes();
      await mw(makeReq({ ip: '10.2.0.1', path: '/api/../../../etc/passwd' }), res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.threats).toContain('path_traversal');
    });

    it('blocks URL-encoded traversal', async () => {
      const mw = createIntrusionDetection({ scoreThreshold: 100 });
      const res = makeRes();
      await mw(makeReq({ ip: '10.2.0.2', query: { file: '%2e%2e%2fetc%2fpasswd' } }), res, jest.fn());
      expect(res._status).toBe(400);
    });
  });

  describe('XSS detection', () => {
    it('blocks script tag injection', async () => {
      const mw = createIntrusionDetection({ scoreThreshold: 100 });
      const res = makeRes();
      await mw(makeReq({ ip: '10.3.0.1', body: { comment: '<script>alert(1)</script>' } }), res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.threats).toContain('xss');
    });
  });

  describe('IP banning', () => {
    it('bans IP once score crosses threshold', async () => {
      const mw = createIntrusionDetection({ scoreThreshold: 5, blockTtlSeconds: 60 });
      const ip = '1.2.3.4';

      // First hit — score = 3 (sql_injection score), below threshold
      const res1 = makeRes();
      await mw(makeReq({ ip, body: { q: "1 UNION SELECT * FROM users" } }), res1, jest.fn());
      expect(res1._status).toBe(400);

      // Second hit — cumulative score >= 5, should ban
      const res2 = makeRes();
      await mw(makeReq({ ip, body: { q: "1 UNION SELECT * FROM users" } }), res2, jest.fn());
      expect(res2._status).toBe(403);
    });

    it('returns 403 for already-blocked IPs on clean requests', async () => {
      const ip = '9.9.9.9';
      // Pre-seed the block key
      redisService._store.set(`ids:block:${ip}`, '1');

      const mw = createIntrusionDetection();
      const res = makeRes();
      const next = jest.fn();
      await mw(makeReq({ ip, body: { name: 'clean' } }), res, next);
      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('command injection detection', () => {
    it('detects shell command injection in body', async () => {
      const mw = createIntrusionDetection({ scoreThreshold: 100 });
      const res = makeRes();
      await mw(makeReq({ ip: '10.4.0.1', body: { cmd: '| bash -c "whoami"' } }), res, jest.fn());
      expect(res._status).toBe(400);
      expect(res._body.threats).toContain('command_injection');
    });
  });

  describe('onBlock callback', () => {
    it('fires onBlock when IP is banned', async () => {
      const onBlock = jest.fn();
      const mw = createIntrusionDetection({ scoreThreshold: 3, onBlock });
      const ip = '5.5.5.5';

      await mw(makeReq({ ip, body: { q: "1 UNION SELECT * FROM users" } }), makeRes(), jest.fn());
      expect(onBlock).toHaveBeenCalledWith(ip, expect.any(Array), expect.any(Number));
    });
  });
});
