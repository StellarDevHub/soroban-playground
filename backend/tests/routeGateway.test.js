/**
 * Route gateway suite for #1491.
 *
 * Mocks every heavy/broken controller import so api.js can be loaded in CI,
 * then asserts the previously orphaned prefixes are mounted (not Express 404),
 * Stellar ID validation rejects malformed identifiers, and readiness rules work.
 */
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const apiPath = join(__dirname, '../src/routes/api.js');
const apiSource = readFileSync(apiPath, 'utf8');

jest.mock('../src/routes/warranty.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/favorites.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/workspace.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/search.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/projects.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/v1/compile.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/v1/deploy.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/v1/invoke.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/v1/identity.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/v1/simulate.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/v2/compile.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/v2/deploy.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/v2/invoke.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/v2/identity.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/v2/lottery.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/events.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/patents.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/tokenBurn.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/oracle.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/verification.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/bugBountyRoutes.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/musicLicensingRoutes.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/sports.routes.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/escrow.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/nftAmm.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/lending.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/social.js', () => require('./_helpers/stubRouter'));
jest.mock('../src/routes/pauseToggle.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/tokenGatedAccess.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/priceAggregator.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/tokenizedReit.js', () =>
  require('./_helpers/stubRouter')
);
jest.mock('../src/routes/readinessRules.routes.js', () => {
  const expressMod = require('express');
  const { computeReadinessStatus } = require('../src/routes/readinessRules.js');
  const router = expressMod.Router();
  router.post('/', (req, res) => {
    const result = computeReadinessStatus(req.body || {});
    res.status(result.httpStatus).json({ success: true, data: result });
  });
  router.get('/rules', (_req, res) => {
    res.json({
      success: true,
      data: { unhealthyWhen: 'any critical dependency status !== healthy' },
    });
  });
  return { __esModule: true, default: router };
});
jest.mock('../src/services/sorobanRpcManager.js', () => ({
  __esModule: true,
  default: { getStatus: () => ({ ok: true }), reset: () => ({ ok: true }) },
}));

const ORPHANED_PREFIXES = [
  '/api/sports',
  '/api/escrow',
  '/api/nft-amm',
  '/api/lending',
  '/api/social',
  '/api/pause-toggle',
  '/api/token-gated-access',
  '/api/price-aggregator',
  '/api/tokenized-reit',
  '/api/readiness',
];

const MUTATING_PREFIXES = [
  '/api/escrow',
  '/api/nft-amm',
  '/api/lending',
  '/api/pause-toggle',
  '/api/tokenized-reit',
];

describe('route gateway (#1491)', () => {
  let app;

  beforeAll(async () => {
    const { default: apiRouter } = await import(apiPath);
    app = express();
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', apiRouter);
    app.use((err, _req, res, _next) => {
      res
        .status(err.status || 500)
        .json({ success: false, error: { message: err.message } });
    });
  });

  describe('static mounts in api.js', () => {
    it.each(ORPHANED_PREFIXES)('mounts %s', (prefix) => {
      const mountPath = prefix.replace('/api', '');
      expect(apiSource).toContain(`'${mountPath}'`);
    });

    it.each(MUTATING_PREFIXES)(
      'applies mutating rate limiter on %s',
      (prefix) => {
        const mountPath = prefix.replace('/api', '');
        const pathOffset = apiSource.indexOf(`'${mountPath}'`);
        const statementStart = apiSource.lastIndexOf('router.use(', pathOffset);
        const statementEnd = apiSource.indexOf(');', pathOffset);
        const statement = apiSource.slice(statementStart, statementEnd);
        expect(statementStart).toBeGreaterThanOrEqual(0);
        expect(statement).toMatch(/stellarIdValidation/);
        expect(statement).toMatch(/mutatingRouteLimiter/);
      }
    );
  });

  describe('mounted responses', () => {
    it.each(ORPHANED_PREFIXES.filter((p) => p !== '/api/readiness'))(
      'GET %s is mounted (not 404)',
      async (path) => {
        const res = await request(app).get(path);
        expect(res.status).not.toBe(404);
        expect(res.headers['content-type']).toMatch(/json/);
      }
    );

    it('GET /api/readiness/rules is mounted (not 404)', async () => {
      const res = await request(app).get('/api/readiness/rules');
      expect(res.status).not.toBe(404);
      expect(res.headers['content-type']).toMatch(/json/);
    });

    it('readiness rules endpoint is exposed', async () => {
      const res = await request(app).get('/api/readiness/rules');
      expect(res.status).toBe(200);
      expect(res.body.data.unhealthyWhen).toBeDefined();
    });
  });

  describe('readiness decision rules', () => {
    it('returns ready when critical deps are healthy', async () => {
      const res = await request(app)
        .post('/api/readiness')
        .send({
          postgres: { status: 'healthy' },
          redis: { status: 'healthy' },
        });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('ready');
    });

    it('returns unhealthy (503) when postgres is down', async () => {
      const res = await request(app)
        .post('/api/readiness')
        .send({ postgres: { status: 'down' }, redis: { status: 'healthy' } });
      expect(res.status).toBe(503);
      expect(res.body.data.status).toBe('unhealthy');
    });

    it('returns degraded when optional deps are unhealthy', async () => {
      const res = await request(app)
        .post('/api/readiness')
        .send({
          postgres: { status: 'healthy' },
          redis: { status: 'healthy' },
          sorobanRpc: { status: 'unhealthy' },
        });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('degraded');
    });
  });
});

describe('stellarIdValidation middleware (#1491)', () => {
  const {
    stellarIdValidation,
  } = require('../src/middleware/stellarIdValidation.js');

  function run(body, query = {}, params = {}) {
    return new Promise((resolve) => {
      const req = { body, query, params };
      const res = {
        statusCode: 200,
        body: undefined,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(payload) {
          this.body = payload;
          resolve({ status: this.statusCode, body: payload });
        },
      };
      stellarIdValidation(req, res, () => resolve({ status: 200, next: true }));
    });
  }

  it('rejects malformed contract IDs in body with 422', async () => {
    const result = await run({ contractId: 'not-a-contract' });
    expect(result.status).toBe(422);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed public keys in body with 422', async () => {
    const result = await run({ address: 'G-not-valid-but-long-enough-xyz' });
    expect(result.status).toBe(422);
  });

  it('accepts valid Stellar contract IDs', async () => {
    const contractId = `C${'A'.repeat(55)}`;
    const result = await run({ contractId });
    expect(result.next).toBe(true);
  });

  it('strips prototype pollution keys from bodies', async () => {
    const req = {
      body: JSON.parse('{"__proto__":{"polluted":true},"ok":1}'),
      query: {},
      params: {},
    };
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        return payload;
      },
    };
    stellarIdValidation(req, res, () => {});
    expect(Object.prototype.polluted).toBeUndefined();
    expect(req.body.ok).toBe(1);
  });
});
