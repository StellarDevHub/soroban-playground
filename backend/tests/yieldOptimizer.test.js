/**
 * Yield Optimizer API – unit tests
 * Mocks invokeService so no real Soroban CLI is needed.
 */

import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

jest.mock('../../src/services/invokeService.js', () => ({
  invokeSorobanContract: jest.fn(),
}));
jest.mock('../../src/middleware/rateLimiter.js', () => ({
  rateLimitMiddleware: () => (_req, _res, next) => next(),
}));

import { invokeSorobanContract } from '../../src/services/invokeService.js';
import yieldOptimizerRoute from '../../src/routes/yieldOptimizer.js';
import { notFoundHandler, errorHandler } from '../../src/middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/yield-optimizer', yieldOptimizerRoute);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADMIN    = 'GDEMO4MV6L6QY6P4UQBW5SC4R6X4P7WALLETDEMO4MV6L6QY6P4UQBW';
const USER     = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('Yield Optimizer API', () => {
  let app;
  beforeEach(() => {
    app = buildApp();
    invokeSorobanContract.mockResolvedValue({ parsed: 'ok' });
  });
  afterEach(() => jest.clearAllMocks());

  describe('POST /initialize', () => {
    it('200 on valid input', async () => {
      const res = await request(app).post('/api/yield-optimizer/initialize')
        .send({ contractId: CONTRACT, admin: ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
    it('400 missing admin', async () => {
      const res = await request(app).post('/api/yield-optimizer/initialize')
        .send({ contractId: CONTRACT });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /protocols', () => {
    it('201 on valid input', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1 });
      const res = await request(app).post('/api/yield-optimizer/protocols')
        .send({ contractId: CONTRACT, admin: ADMIN, name: 'AMM Pool', baseApyBps: 800 });
      expect(res.status).toBe(201);
      expect(res.body.protocolId).toBe(1);
    });
    it('400 when baseApyBps exceeds 50000', async () => {
      const res = await request(app).post('/api/yield-optimizer/protocols')
        .send({ contractId: CONTRACT, admin: ADMIN, name: 'X', baseApyBps: 50001 });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /protocols/:id/apy', () => {
    it('200 on valid update', async () => {
      const res = await request(app).patch('/api/yield-optimizer/protocols/1/apy')
        .send({ contractId: CONTRACT, admin: ADMIN, newApyBps: 1200 });
      expect(res.status).toBe(200);
      expect(invokeSorobanContract).toHaveBeenCalledWith(
        expect.objectContaining({ functionName: 'update_protocol_apy' })
      );
    });
  });

  describe('POST /vaults', () => {
    it('201 on valid input', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1 });
      const res = await request(app).post('/api/yield-optimizer/vaults')
        .send({ contractId: CONTRACT, admin: ADMIN, name: 'Vault A', protocolId: 1 });
      expect(res.status).toBe(201);
      expect(res.body.vaultId).toBe(1);
    });
    it('400 when protocolId is missing', async () => {
      const res = await request(app).post('/api/yield-optimizer/vaults')
        .send({ contractId: CONTRACT, admin: ADMIN, name: 'Vault A' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /vaults', () => {
    it('returns vault count', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 3 });
      const res = await request(app).get('/api/yield-optimizer/vaults')
        .query({ contractId: CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.vaultCount).toBe(3);
    });
  });

  describe('POST /vaults/:id/deposit', () => {
    it('returns compounded balance', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1000000 });
      const res = await request(app).post('/api/yield-optimizer/vaults/1/deposit')
        .send({ contractId: CONTRACT, user: USER, amount: 1000000 });
      expect(res.status).toBe(200);
      expect(res.body.compoundedBalance).toBe(1000000);
    });
    it('400 when amount is zero', async () => {
      const res = await request(app).post('/api/yield-optimizer/vaults/1/deposit')
        .send({ contractId: CONTRACT, user: USER, amount: 0 });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /vaults/:id/withdraw', () => {
    it('returns withdrawn amount', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 500000 });
      const res = await request(app).post('/api/yield-optimizer/vaults/1/withdraw')
        .send({ contractId: CONTRACT, user: USER, amount: 500000 });
      expect(res.status).toBe(200);
      expect(res.body.withdrawn).toBe(500000);
    });
  });

  describe('POST /vaults/:id/compound', () => {
    it('returns rewards compounded', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 12345 });
      const res = await request(app).post('/api/yield-optimizer/vaults/1/compound')
        .send({ contractId: CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.rewardsCompounded).toBe(12345);
    });
  });

  describe('GET /vaults/:id/estimated/:user', () => {
    it('returns estimated balance', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1050000 });
      const res = await request(app)
        .get(`/api/yield-optimizer/vaults/1/estimated/${USER}`)
        .query({ contractId: CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.estimatedBalance).toBe(1050000);
    });
    it('400 for invalid user address', async () => {
      const res = await request(app)
        .get('/api/yield-optimizer/vaults/1/estimated/bad-addr')
        .query({ contractId: CONTRACT });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /vaults/:id/backtest', () => {
    it('201 with backtest id', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1 });
      const res = await request(app).post('/api/yield-optimizer/vaults/1/backtest')
        .send({ contractId: CONTRACT, admin: ADMIN });
      expect(res.status).toBe(201);
      expect(res.body.backtestId).toBe(1);
    });
  });

  describe('POST /pause and /unpause', () => {
    it('pauses contract', async () => {
      const res = await request(app).post('/api/yield-optimizer/pause')
        .send({ contractId: CONTRACT, admin: ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/paused/i);
    });
    it('unpauses contract', async () => {
      const res = await request(app).post('/api/yield-optimizer/unpause')
        .send({ contractId: CONTRACT, admin: ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/unpaused/i);
    });
  });
});
