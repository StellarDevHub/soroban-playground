/**
 * Tokenized REIT API – unit tests
 *
 * Mocks invokeService so no real Soroban CLI is needed.
 */

import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

// ── Mock invokeService ────────────────────────────────────────────────────────
jest.mock('../../src/services/invokeService.js', () => ({
  invokeSorobanContract: jest.fn(),
}));

// ── Mock rateLimiter (pass-through) ──────────────────────────────────────────
jest.mock('../../src/middleware/rateLimiter.js', () => ({
  rateLimitMiddleware: () => (_req, _res, next) => next(),
}));

import { invokeSorobanContract } from '../../src/services/invokeService.js';
import tokenizedReitRoute from '../../src/routes/tokenizedReit.js';
import { notFoundHandler, errorHandler } from '../../src/middleware/errorHandler.js';

// ── Test app ──────────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reit', tokenizedReitRoute);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const VALID_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_ADMIN    = 'GDEMO4MV6L6QY6P4UQBW5SC4R6X4P7WALLETDEMO4MV6L6QY6P4UQBW';
const VALID_INVESTOR = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('Tokenized REIT API', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    invokeSorobanContract.mockResolvedValue({ parsed: 'ok', stdout: '', stderr: '' });
  });

  afterEach(() => jest.clearAllMocks());

  // ── POST /initialize ────────────────────────────────────────────────────────
  describe('POST /api/reit/initialize', () => {
    it('returns 200 on valid input', async () => {
      const res = await request(app)
        .post('/api/reit/initialize')
        .send({ contractId: VALID_CONTRACT, admin: VALID_ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(invokeSorobanContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'initialize' })
      );
    });

    it('returns 400 when contractId is missing', async () => {
      const res = await request(app)
        .post('/api/reit/initialize')
        .send({ admin: VALID_ADMIN });
      expect(res.status).toBe(400);
    });

    it('returns 400 when admin address is invalid', async () => {
      const res = await request(app)
        .post('/api/reit/initialize')
        .send({ contractId: VALID_CONTRACT, admin: 'bad-address' });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /trusts ────────────────────────────────────────────────────────────
  describe('POST /api/reit/trusts', () => {
    const validBody = {
      contractId: VALID_CONTRACT,
      admin: VALID_ADMIN,
      name: 'Downtown Office REIT',
      totalShares: 1000,
      pricePerShare: 1000000,
      annualYieldBps: 500,
    };

    it('returns 201 on valid input', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1 });
      const res = await request(app).post('/api/reit/trusts').send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.trustId).toBe(1);
      expect(invokeSorobanContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'create_trust' })
      );
    });

    it('returns 400 when name is missing', async () => {
      const { name, ...body } = validBody;
      const res = await request(app).post('/api/reit/trusts').send(body);
      expect(res.status).toBe(400);
    });

    it('returns 400 when totalShares is zero', async () => {
      const res = await request(app)
        .post('/api/reit/trusts')
        .send({ ...validBody, totalShares: 0 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when annualYieldBps exceeds 10000', async () => {
      const res = await request(app)
        .post('/api/reit/trusts')
        .send({ ...validBody, annualYieldBps: 10001 });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /trusts ─────────────────────────────────────────────────────────────
  describe('GET /api/reit/trusts', () => {
    it('returns trust count', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 3 });
      const res = await request(app)
        .get('/api/reit/trusts')
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.trustCount).toBe(3);
    });

    it('returns 400 when contractId is missing', async () => {
      const res = await request(app).get('/api/reit/trusts');
      expect(res.status).toBe(400);
    });
  });

  // ── GET /trusts/:id ─────────────────────────────────────────────────────────
  describe('GET /api/reit/trusts/:id', () => {
    it('returns trust data', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: { name: 'Test REIT', total_shares: 1000 } });
      const res = await request(app)
        .get('/api/reit/trusts/1')
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.trust).toBeDefined();
    });

    it('returns 400 for invalid trust id', async () => {
      const res = await request(app)
        .get('/api/reit/trusts/abc')
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /trusts/:id/dividends ──────────────────────────────────────────────
  describe('POST /api/reit/trusts/:id/dividends', () => {
    it('returns 200 on valid deposit', async () => {
      const res = await request(app)
        .post('/api/reit/trusts/1/dividends')
        .send({ contractId: VALID_CONTRACT, admin: VALID_ADMIN, amount: 1000000 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(invokeSorobanContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'deposit_dividends' })
      );
    });

    it('returns 400 when amount is zero', async () => {
      const res = await request(app)
        .post('/api/reit/trusts/1/dividends')
        .send({ contractId: VALID_CONTRACT, admin: VALID_ADMIN, amount: 0 });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /trusts/:id/buy ────────────────────────────────────────────────────
  describe('POST /api/reit/trusts/:id/buy', () => {
    it('returns cost on valid purchase', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 500000 });
      const res = await request(app)
        .post('/api/reit/trusts/1/buy')
        .send({ contractId: VALID_CONTRACT, investor: VALID_INVESTOR, shares: 5 });
      expect(res.status).toBe(200);
      expect(res.body.cost).toBe(500000);
    });

    it('returns 400 for non-integer shares', async () => {
      const res = await request(app)
        .post('/api/reit/trusts/1/buy')
        .send({ contractId: VALID_CONTRACT, investor: VALID_INVESTOR, shares: 1.5 });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /trusts/:id/transfer ───────────────────────────────────────────────
  describe('POST /api/reit/trusts/:id/transfer', () => {
    it('returns 200 on valid transfer', async () => {
      const res = await request(app)
        .post('/api/reit/trusts/1/transfer')
        .send({ contractId: VALID_CONTRACT, from: VALID_ADMIN, to: VALID_INVESTOR, shares: 10 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 when from === to', async () => {
      const res = await request(app)
        .post('/api/reit/trusts/1/transfer')
        .send({ contractId: VALID_CONTRACT, from: VALID_ADMIN, to: VALID_ADMIN, shares: 10 });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /trusts/:id/claim ──────────────────────────────────────────────────
  describe('POST /api/reit/trusts/:id/claim', () => {
    it('returns claimed amount', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 250000 });
      const res = await request(app)
        .post('/api/reit/trusts/1/claim')
        .send({ contractId: VALID_CONTRACT, investor: VALID_INVESTOR });
      expect(res.status).toBe(200);
      expect(res.body.amount).toBe(250000);
    });
  });

  // ── GET /trusts/:id/claimable/:investor ─────────────────────────────────────
  describe('GET /api/reit/trusts/:id/claimable/:investor', () => {
    it('returns claimable amount', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 125000 });
      const res = await request(app)
        .get(`/api/reit/trusts/1/claimable/${VALID_INVESTOR}`)
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.claimable).toBe(125000);
    });

    it('returns 400 for invalid investor address', async () => {
      const res = await request(app)
        .get('/api/reit/trusts/1/claimable/bad-address')
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /pause & /unpause ──────────────────────────────────────────────────
  describe('POST /api/reit/pause', () => {
    it('pauses the contract', async () => {
      const res = await request(app)
        .post('/api/reit/pause')
        .send({ contractId: VALID_CONTRACT, admin: VALID_ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/paused/i);
    });
  });

  describe('POST /api/reit/unpause', () => {
    it('unpauses the contract', async () => {
      const res = await request(app)
        .post('/api/reit/unpause')
        .send({ contractId: VALID_CONTRACT, admin: VALID_ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/unpaused/i);
    });
  });
});
