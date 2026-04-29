import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

// ── Mock dependencies ─────────────────────────────────────────────────────────

jest.mock('../../src/services/invokeService.js', () => ({
  invokeSorobanContract: jest.fn(),
}));

jest.mock('../../src/services/cacheService.js', () => ({
  default: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(true) },
}));

import { invokeSorobanContract } from '../../src/services/invokeService.js';
import cacheService from '../../src/services/cacheService.js';
import supplyChainRouter from '../../src/routes/v1/supply-chain.js';
import { notFoundHandler, errorHandler } from '../../src/middleware/errorHandler.js';

// ── Test app ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/', supplyChainRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

const VALID_CONTRACT = 'C' + 'A'.repeat(55);
const VALID_ADDRESS  = 'G' + 'A'.repeat(55);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /:contractId/products', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('returns count from invoke result', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: 3 });
    const res = await request(app).get(`/${VALID_CONTRACT}/products`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, count: 3 });
  });

  it('returns cached count without invoking', async () => {
    cacheService.get.mockResolvedValue('5');
    const res = await request(app).get(`/${VALID_CONTRACT}/products`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
    expect(invokeSorobanContract).not.toHaveBeenCalled();
  });

  it('rejects invalid contractId', async () => {
    const res = await request(app).get('/INVALID/products');
    expect(res.status).toBe(400);
  });
});

describe('GET /:contractId/products/:productId', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('returns product data', async () => {
    const product = { id: 1, name: 'Widget', status: 'Registered' };
    invokeSorobanContract.mockResolvedValue({ parsed: product });
    const res = await request(app).get(`/${VALID_CONTRACT}/products/1`);
    expect(res.status).toBe(200);
    expect(res.body.product).toEqual(product);
  });

  it('rejects non-integer productId', async () => {
    const res = await request(app).get(`/${VALID_CONTRACT}/products/abc`);
    expect(res.status).toBe(400);
  });

  it('rejects productId of 0', async () => {
    const res = await request(app).get(`/${VALID_CONTRACT}/products/0`);
    expect(res.status).toBe(400);
  });
});

describe('POST /:contractId/products', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('registers a product and returns productId', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: 1 });
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products`)
      .send({ owner: VALID_ADDRESS, name: 'Widget A', metadataHash: 12345 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, productId: 1 });
  });

  it('rejects missing name', async () => {
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products`)
      .send({ owner: VALID_ADDRESS, metadataHash: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects invalid owner address', async () => {
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products`)
      .send({ owner: 'bad', name: 'Widget', metadataHash: 0 });
    expect(res.status).toBe(400);
  });

  it('rejects non-number metadataHash', async () => {
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products`)
      .send({ owner: VALID_ADDRESS, name: 'Widget', metadataHash: 'abc' });
    expect(res.status).toBe(400);
  });
});

describe('POST /:contractId/products/:productId/checkpoints', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('adds a checkpoint', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: 1 });
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products/1/checkpoints`)
      .send({ handler: VALID_ADDRESS, locationHash: 111, notesHash: 222 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, checkpointIndex: 1 });
  });

  it('rejects invalid handler address', async () => {
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products/1/checkpoints`)
      .send({ handler: 'bad', locationHash: 0, notesHash: 0 });
    expect(res.status).toBe(400);
  });
});

describe('POST /:contractId/products/:productId/quality-report', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('submits a quality report', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: null });
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products/1/quality-report`)
      .send({ inspector: VALID_ADDRESS, result: 'Pass', reportHash: 999 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects invalid result value', async () => {
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products/1/quality-report`)
      .send({ inspector: VALID_ADDRESS, result: 'Unknown', reportHash: 0 });
    expect(res.status).toBe(400);
  });
});

describe('POST /:contractId/products/:productId/recall', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('recalls a product', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: null });
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/products/1/recall`)
      .send({ caller: VALID_ADDRESS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /:contractId/pause and unpause', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('pauses the contract', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: null });
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/pause`)
      .send({ caller: VALID_ADDRESS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('unpauses the contract', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: null });
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/unpause`)
      .send({ caller: VALID_ADDRESS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects pause with invalid caller', async () => {
    const res = await request(app)
      .post(`/${VALID_CONTRACT}/pause`)
      .send({ caller: 'bad' });
    expect(res.status).toBe(400);
  });
});

describe('GET /:contractId/paused', () => {
  let app;
  beforeEach(() => { app = buildApp(); jest.clearAllMocks(); });

  it('returns paused state', async () => {
    invokeSorobanContract.mockResolvedValue({ parsed: false });
    const res = await request(app).get(`/${VALID_CONTRACT}/paused`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, paused: false });
  });
});
