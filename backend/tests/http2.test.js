import {
  KEEP_ALIVE_TIMEOUT_MS,
  HEADERS_TIMEOUT_MS,
  SESSION_TIMEOUT_MS,
  PUSH_RULES,
  HTTP2_SERVER_OPTIONS,
  applyServerTuning,
} from '../src/config/http2Config.js';
import {
  buildLinkHeader,
  http2PushMiddleware,
} from '../src/middleware/http2Push.js';

// ── Configuration values ──────────────────────────────────────────────────────

describe('http2Config constants', () => {
  it('keep-alive timeout exceeds 60 s to outlast upstream LB idle timeout', () => {
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  it('headers timeout is shorter than keep-alive timeout', () => {
    expect(HEADERS_TIMEOUT_MS).toBeLessThan(KEEP_ALIVE_TIMEOUT_MS);
  });

  it('session timeout is at least 60 s', () => {
    expect(SESSION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('HTTP2_SERVER_OPTIONS allows HTTP/1.1 fallback', () => {
    expect(HTTP2_SERVER_OPTIONS.allowHTTP1).toBe(true);
  });

  it('HTTP2_SERVER_OPTIONS caps concurrent streams', () => {
    expect(HTTP2_SERVER_OPTIONS.settings.maxConcurrentStreams).toBeGreaterThan(
      0
    );
  });

  it('PUSH_RULES is a non-empty array with match and assets fields', () => {
    expect(Array.isArray(PUSH_RULES)).toBe(true);
    expect(PUSH_RULES.length).toBeGreaterThan(0);
    for (const rule of PUSH_RULES) {
      expect(rule.match).toBeInstanceOf(RegExp);
      expect(Array.isArray(rule.assets)).toBe(true);
    }
  });
});

describe('applyServerTuning', () => {
  it('sets keepAliveTimeout on the server object', () => {
    const server = {};
    applyServerTuning(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
  });

  it('sets headersTimeout on the server object', () => {
    const server = {};
    applyServerTuning(server);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
  });

  it('returns the server for chaining', () => {
    const server = {};
    expect(applyServerTuning(server)).toBe(server);
  });
});

// ── Push middleware ───────────────────────────────────────────────────────────

describe('buildLinkHeader', () => {
  it('produces Link: preload headers for CSS assets', () => {
    const header = buildLinkHeader([
      { path: '/static/main.css', contentType: 'text/css' },
    ]);
    expect(header).toBe('</static/main.css>; rel=preload; as=style');
  });

  it('produces Link: preload headers for JS assets', () => {
    const header = buildLinkHeader([
      { path: '/static/app.js', contentType: 'application/javascript' },
    ]);
    expect(header).toBe('</static/app.js>; rel=preload; as=script');
  });

  it('joins multiple assets with comma separator', () => {
    const header = buildLinkHeader([
      { path: '/a.css', contentType: 'text/css' },
      { path: '/b.js', contentType: 'application/javascript' },
    ]);
    expect(header).toContain(', ');
    expect(header.split(', ')).toHaveLength(2);
  });

  it('caps at 10 assets to avoid oversized headers', () => {
    const assets = Array.from({ length: 15 }, (_, i) => ({
      path: `/asset${i}.js`,
      contentType: 'application/javascript',
    }));
    const header = buildLinkHeader(assets);
    expect(header.split(', ')).toHaveLength(10);
  });
});

describe('http2PushMiddleware', () => {
  function makeReqRes(path) {
    const req = { path };
    const headers = {};
    const res = {
      stream: null, // no HTTP/2 stream – simulates HTTP/1.1
      setHeader: jest.fn((k, v) => {
        headers[k] = v;
      }),
      getHeaders: () => headers,
    };
    return { req, res, headers };
  }

  it('sets Link header for matched path on HTTP/1.1 (no stream)', () => {
    const { req, res, headers } = makeReqRes('/');
    const next = jest.fn();

    http2PushMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(headers['Link']).toBeDefined();
    expect(headers['Link']).toContain('rel=preload');
  });

  it('calls next() even when no rule matches', () => {
    const { req, res } = makeReqRes('/api/some/path');
    const next = jest.fn();

    http2PushMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('calls next() for matched path with HTTP/2 stream available', () => {
    const { req, res } = makeReqRes('/');
    res.stream = {
      destroyed: false,
      pushStream: jest.fn((_headers, cb) =>
        cb(null, { respond: jest.fn(), end: jest.fn(), on: jest.fn() })
      ),
    };
    const next = jest.fn();

    http2PushMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.stream.pushStream).toHaveBeenCalled();
  });

  it('skips push on a destroyed HTTP/2 stream', () => {
    const { req, res } = makeReqRes('/');
    res.stream = { destroyed: true, pushStream: jest.fn() };
    const next = jest.fn();

    http2PushMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    // falls back to Link header since stream is destroyed
    expect(res.setHeader).toHaveBeenCalledWith('Link', expect.any(String));
  });
});
