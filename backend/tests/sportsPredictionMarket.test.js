/**
 * Sports Prediction Market API – unit tests
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
import sportsPredictionMarketRoute from '../../src/routes/sportsPredictionMarket.js';
import { notFoundHandler, errorHandler } from '../../src/middleware/errorHandler.js';

// ── Test app ──────────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sports-markets', sportsPredictionMarketRoute);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const VALID_CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_ADDRESS  = 'GDEMO4MV6L6QY6P4UQBW5SC4R6X4P7WALLETDEMO4MV6L6QY6P4UQBW';

describe('Sports Prediction Market API', () => {
  let app;

  beforeEach(() => {
    app = buildApp();
    invokeSorobanContract.mockResolvedValue({ parsed: 'ok', stdout: '', stderr: '' });
  });

  afterEach(() => jest.clearAllMocks());

  // ── POST /initialize ────────────────────────────────────────────────────────
  describe('POST /api/sports-markets/initialize', () => {
    it('returns 200 on valid input', async () => {
      const res = await request(app)
        .post('/api/sports-markets/initialize')
        .send({ contractId: VALID_CONTRACT, admin: VALID_ADDRESS });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(invokeSorobanContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'initialize' })
      );
    });

    it('returns 400 when contractId is missing', async () => {
      const res = await request(app)
        .post('/api/sports-markets/initialize')
        .send({ admin: VALID_ADDRESS });
      expect(res.status).toBe(400);
    });

    it('returns 400 when admin address is invalid', async () => {
      const res = await request(app)
        .post('/api/sports-markets/initialize')
        .send({ contractId: VALID_CONTRACT, admin: 'not-an-address' });
      expect(res.status).toBe(400);
    });
  });

  // ── POST / (create market) ──────────────────────────────────────────────────
  describe('POST /api/sports-markets', () => {
    const validBody = {
      contractId: VALID_CONTRACT,
      creator: VALID_ADDRESS,
      description: 'Lakers vs Celtics',
      sport: 1,
      homeTeam: 'Lakers',
      awayTeam: 'Celtics',
      resolutionDeadline: Math.floor(Date.now() / 1000) + 86400,
      oracle: VALID_ADDRESS,
      oddsHomeBp: 18000,
      oddsDrawBp: 35000,
      oddsAwayBp: 22000,
    };

    it('returns 201 on valid input', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1, stdout: '', stderr: '' });
      const res = await request(app).post('/api/sports-markets').send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.marketId).toBe(1);
    });

    it('returns 400 when odds are below minimum', async () => {
      const res = await request(app)
        .post('/api/sports-markets')
        .send({ ...validBody, oddsHomeBp: 5000 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when sport is out of range', async () => {
      const res = await request(app)
        .post('/api/sports-markets')
        .send({ ...validBody, sport: 99 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when deadline is in the past', async () => {
      const res = await request(app)
        .post('/api/sports-markets')
        .send({ ...validBody, resolutionDeadline: 1000 });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /:id ────────────────────────────────────────────────────────────────
  describe('GET /api/sports-markets/:id', () => {
    it('returns market data', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: { id: 1 }, stdout: '', stderr: '' });
      const res = await request(app)
        .get('/api/sports-markets/1')
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.market).toEqual({ id: 1 });
    });

    it('returns 400 for invalid id', async () => {
      const res = await request(app)
        .get('/api/sports-markets/abc')
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /:id/bet ───────────────────────────────────────────────────────────
  describe('POST /api/sports-markets/:id/bet', () => {
    it('places a bet successfully', async () => {
      const res = await request(app)
        .post('/api/sports-markets/1/bet')
        .send({ contractId: VALID_CONTRACT, bettor: VALID_ADDRESS, outcome: 0, stake: 500 });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid outcome', async () => {
      const res = await request(app)
        .post('/api/sports-markets/1/bet')
        .send({ contractId: VALID_CONTRACT, bettor: VALID_ADDRESS, outcome: 5, stake: 500 });
      expect(res.status).toBe(400);
    });

    it('returns 400 for zero stake', async () => {
      const res = await request(app)
        .post('/api/sports-markets/1/bet')
        .send({ contractId: VALID_CONTRACT, bettor: VALID_ADDRESS, outcome: 0, stake: 0 });
      expect(res.status).toBe(400);
    });
  });

  // ── POST /:id/resolve ───────────────────────────────────────────────────────
  describe('POST /api/sports-markets/:id/resolve', () => {
    it('resolves a market', async () => {
      const res = await request(app)
        .post('/api/sports-markets/1/resolve')
        .send({ contractId: VALID_CONTRACT, winningOutcome: 0 });
      expect(res.status).toBe(200);
      expect(invokeSorobanContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'resolve_market' })
      );
    });

    it('returns 400 for invalid winningOutcome', async () => {
      const res = await request(app)
        .post('/api/sports-markets/1/resolve')
        .send({ contractId: VALID_CONTRACT, winningOutcome: 9 });
      expect(res.status).toBe(400);
    });
  });

  // ── GET /:id/analytics ──────────────────────────────────────────────────────
  describe('GET /api/sports-markets/:id/analytics', () => {
    it('returns analytics', async () => {
      invokeSorobanContract.mockResolvedValue({
        parsed: [10000, 5000, 3000, 2000],
        stdout: '',
        stderr: '',
      });
      const res = await request(app)
        .get('/api/sports-markets/1/analytics')
        .query({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.analytics.totalPool).toBe(10000);
      expect(res.body.analytics.home.pct).toBe('50.00');
    });
  });

  // ── POST /pause & /unpause ──────────────────────────────────────────────────
  describe('POST /api/sports-markets/pause', () => {
    it('pauses the contract', async () => {
      const res = await request(app)
        .post('/api/sports-markets/pause')
        .send({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/paused/i);
    });
  });

  describe('POST /api/sports-markets/unpause', () => {
    it('unpauses the contract', async () => {
      const res = await request(app)
        .post('/api/sports-markets/unpause')
        .send({ contractId: VALID_CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/unpaused/i);
    });
  });
});
