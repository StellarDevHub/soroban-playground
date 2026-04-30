/**
 * Warranty Management API – unit tests
 */

import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

jest.mock('../../src/services/invokeService.js', () => ({ invokeSorobanContract: jest.fn() }));
jest.mock('../../src/middleware/rateLimiter.js', () => ({ rateLimitMiddleware: () => (_req, _res, next) => next() }));

import { invokeSorobanContract } from '../../src/services/invokeService.js';
import warrantyManagementRoute from '../../src/routes/warrantyManagement.js';
import { notFoundHandler, errorHandler } from '../../src/middleware/errorHandler.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/warranty', warrantyManagementRoute);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADMIN    = 'GDEMO4MV6L6QY6P4UQBW5SC4R6X4P7WALLETDEMO4MV6L6QY6P4UQBW';
const USER     = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('Warranty Management API', () => {
  let app;
  beforeEach(() => { app = buildApp(); invokeSorobanContract.mockResolvedValue({ parsed: 'ok' }); });
  afterEach(() => jest.clearAllMocks());

  describe('POST /initialize', () => {
    it('200 on valid input', async () => {
      const res = await request(app).post('/api/warranty/initialize').send({ contractId: CONTRACT, admin: ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
    it('400 missing admin', async () => {
      const res = await request(app).post('/api/warranty/initialize').send({ contractId: CONTRACT });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /products', () => {
    it('201 on valid input', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1 });
      const res = await request(app).post('/api/warranty/products').send({
        contractId: CONTRACT, admin: ADMIN, name: 'Laptop', manufacturer: USER, defaultWarrantySecs: 31536000,
      });
      expect(res.status).toBe(201);
      expect(res.body.productId).toBe(1);
    });
    it('400 when defaultWarrantySecs is zero', async () => {
      const res = await request(app).post('/api/warranty/products').send({
        contractId: CONTRACT, admin: ADMIN, name: 'X', manufacturer: USER, defaultWarrantySecs: 0,
      });
      expect(res.status).toBe(400);
    });
    it('400 when manufacturer address is invalid', async () => {
      const res = await request(app).post('/api/warranty/products').send({
        contractId: CONTRACT, admin: ADMIN, name: 'X', manufacturer: 'bad', defaultWarrantySecs: 100,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /warranties', () => {
    it('201 on valid input', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1 });
      const res = await request(app).post('/api/warranty/warranties').send({
        contractId: CONTRACT, admin: ADMIN, productId: 1, owner: USER,
      });
      expect(res.status).toBe(201);
      expect(res.body.warrantyId).toBe(1);
    });
    it('400 when owner is missing', async () => {
      const res = await request(app).post('/api/warranty/warranties').send({
        contractId: CONTRACT, admin: ADMIN, productId: 1,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /warranties/:id/valid', () => {
    it('returns validity', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: true });
      const res = await request(app).get('/api/warranty/warranties/1/valid').query({ contractId: CONTRACT });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    });
  });

  describe('POST /claims', () => {
    it('201 on valid claim', async () => {
      invokeSorobanContract.mockResolvedValue({ parsed: 1 });
      const res = await request(app).post('/api/warranty/claims').send({
        contractId: CONTRACT, claimant: USER, warrantyId: 1, description: 'Screen cracked',
      });
      expect(res.status).toBe(201);
      expect(res.body.claimId).toBe(1);
    });
    it('400 when description is empty', async () => {
      const res = await request(app).post('/api/warranty/claims').send({
        contractId: CONTRACT, claimant: USER, warrantyId: 1, description: '',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /claims/:id/process', () => {
    it('approves claim', async () => {
      const res = await request(app).post('/api/warranty/claims/1/process').send({
        contractId: CONTRACT, admin: ADMIN, approve: true,
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/approved/i);
    });
    it('rejects claim', async () => {
      const res = await request(app).post('/api/warranty/claims/1/process').send({
        contractId: CONTRACT, admin: ADMIN, approve: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/rejected/i);
    });
    it('400 when approve is not boolean', async () => {
      const res = await request(app).post('/api/warranty/claims/1/process').send({
        contractId: CONTRACT, admin: ADMIN, approve: 'yes',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /pause and /unpause', () => {
    it('pauses', async () => {
      const res = await request(app).post('/api/warranty/pause').send({ contractId: CONTRACT, admin: ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/paused/i);
    });
    it('unpauses', async () => {
      const res = await request(app).post('/api/warranty/unpause').send({ contractId: CONTRACT, admin: ADMIN });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/unpaused/i);
    });
  });
});
