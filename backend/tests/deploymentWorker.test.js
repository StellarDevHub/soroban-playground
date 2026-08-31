// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import deployRouter from '../src/routes/v1/deploy.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

jest.mock('../src/services/deployService.js', () => ({
  deployContract: jest.fn().mockResolvedValue({
    contractId: 'CABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQR',
    stdout: 'CABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQR',
    stderr: '',
  }),
  deployBatchContracts: jest.fn(),
  validateDeployContract: jest.fn(),
}));

describe('Async WASM Deployment Queue API', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/deploy', deployRouter);
    app.use(errorHandler);
  });

  it('POST /api/deploy/async queues a deployment job', async () => {
    const res = await request(app).post('/api/deploy/async').send({
      wasmPath: '/tmp/contract.wasm',
      contractName: 'test_contract',
    });

    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(res.body.jobId).toBeDefined();
    expect(res.body.status).toBe('queued');
  });

  it('POST /api/deploy/async rejects missing fields', async () => {
    const res = await request(app).post('/api/deploy/async').send({});

    expect(res.status).toBe(400);
  });

  it('GET /api/deploy/job/:jobId checks queued job status', async () => {
    const postRes = await request(app).post('/api/deploy/async').send({
      wasmPath: '/tmp/contract.wasm',
      contractName: 'test_contract',
    });

    const jobId = postRes.body.jobId;
    const getRes = await request(app).get(`/api/deploy/job/${jobId}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.jobId).toBe(jobId);
    expect(getRes.body.status).toBeDefined();
  });
});
