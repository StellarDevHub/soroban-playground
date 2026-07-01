import express from 'express';
import request from 'supertest';
import { compileQueued } from '../src/services/compileService.js';
import v1Compile from '../src/routes/v1/compile.js';
import v2Compile from '../src/routes/v2/compile.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  dispatchByApiVersion,
  negotiateApiVersion,
  rejectUnsupportedUriVersion,
} from '../src/middleware/apiVersioning.js';
import { deprecationHeaders } from '../src/middleware/deprecationHeaders.js';
import {
  requestTransformerV2,
  versionTransformer,
} from '../src/middleware/versionTransformer.js';

jest.mock('../src/middleware/rateLimiter.js', () => ({
  rateLimitMiddleware: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../src/services/compileService.js', () => ({
  compileQueued: jest.fn(),
  compileBatch: jest.fn(),
  getCompileSnapshot: jest.fn(),
  compileProgressBus: { on: jest.fn() },
}));

const app = express();
const v1Router = express.Router();
v1Router.use(versionTransformer('v1'));
v1Router.use('/compile', v1Compile);

const v2Router = express.Router();
v2Router.use(versionTransformer('v2'));
v2Router.use(requestTransformerV2);
v2Router.use('/compile', v2Compile);

const versionRouters = {
  v1: v1Router,
  v2: v2Router,
};

app.use(express.json());
app.use(
  '/api/v1',
  negotiateApiVersion({ uriVersion: 'v1' }),
  deprecationHeaders,
  v1Router
);
app.use(
  '/api/v2',
  negotiateApiVersion({ uriVersion: 'v2' }),
  deprecationHeaders,
  v2Router
);
app.use('/api', (req, res, next) => {
  if (/^\/v\d+(?:\/|$)/i.test(req.path)) {
    return rejectUnsupportedUriVersion(req, res, next);
  }

  return next();
});
app.use(
  '/api',
  (req, res, next) => {
    if (req.path !== '/compile' && !req.path.startsWith('/compile/')) {
      return next();
    }

    return negotiateApiVersion()(req, res, next);
  },
  deprecationHeaders,
  dispatchByApiVersion(versionRouters)
);
app.use(errorHandler);

function mockCompileResult() {
  compileQueued.mockResolvedValue({
    cached: false,
    hash: 'abc123',
    durationMs: 12,
    logs: ['compiled'],
    artifact: {
      name: 'contract.wasm',
      sizeBytes: 256,
      path: '/tmp/contract.wasm',
    },
  });
}

describe('API version routing', () => {
  let consoleLogSpy;
  let consoleWarnSpy;

  beforeAll(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCompileResult();
  });

  it('routes /api/v1 requests to v1 controllers', async () => {
    const res = await request(app)
      .post('/api/v1/compile')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(200);
    expect(res.headers['api-version']).toBe('v1');
    expect(res.body.durationMs).toBe(12);
    expect(res.body.artifact.sizeBytes).toBe(256);
    expect(res.body.duration_ms).toBeUndefined();
  });

  it('routes /api/v2 requests to v2 controllers', async () => {
    const res = await request(app)
      .post('/api/v2/compile')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(200);
    expect(res.headers['api-version']).toBe('v2');
    expect(res.body.duration_ms).toBe(12);
    expect(res.body.artifact.size_bytes).toBe(256);
    expect(res.body.durationMs).toBeUndefined();
  });

  it('uses v1 as the default version for legacy unversioned routes', async () => {
    const res = await request(app)
      .post('/api/compile')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(200);
    expect(res.headers['api-version']).toBe('v1');
    expect(res.body.durationMs).toBe(12);
  });

  it('routes unversioned requests by custom Accept header', async () => {
    const res = await request(app)
      .post('/api/compile')
      .set('Accept', 'application/vnd.soroban-playground.v2+json')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(200);
    expect(res.headers['api-version']).toBe('v2');
    expect(res.body.duration_ms).toBe(12);
  });

  it('routes unversioned requests by Accept-Version header', async () => {
    const res = await request(app)
      .post('/api/compile')
      .set('Accept-Version', '2')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(200);
    expect(res.headers['api-version']).toBe('v2');
    expect(res.body.duration_ms).toBe(12);
  });

  it('returns a clean 400 payload for unsupported URI versions', async () => {
    const res = await request(app)
      .post('/api/v3/compile')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'Unsupported API version: v3',
      statusCode: 400,
      details: {
        requestedVersion: 'v3',
        supportedVersions: ['v1', 'v2'],
        defaultVersion: 'v1',
      },
    });
  });

  it('returns a clean 400 payload for unsupported header versions', async () => {
    const res = await request(app)
      .post('/api/compile')
      .set('Accept', 'application/vnd.soroban-playground.v9+json')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'Unsupported API version: v9',
      statusCode: 400,
      details: {
        requestedVersion: 'v9',
        supportedVersions: ['v1', 'v2'],
        defaultVersion: 'v1',
      },
    });
  });

  it('returns a clean 400 payload for malformed explicit version headers', async () => {
    const res = await request(app)
      .post('/api/compile')
      .set('Accept-Version', 'banana')
      .send({ code: 'fn main() {}' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      message: 'Unsupported API version: banana',
      statusCode: 400,
      details: {
        requestedVersion: 'banana',
        supportedVersions: ['v1', 'v2'],
        defaultVersion: 'v1',
      },
    });
  });
});
