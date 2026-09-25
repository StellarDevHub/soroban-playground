// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import request from 'supertest';
import express from 'express';
import { rateLimiter } from '../src/middleware/rateLimiter.js';
import metricsRouter, { activeCompilationJobs } from '../src/routes/metrics.js';
import simulateRouter from '../src/routes/v1/simulate.js';
import {
  generateSignature,
  verifySignature,
  buildDeliveryHeaders,
} from '../src/services/webhookUtils.js';

describe('Issue #1024: Distributed Rate Limiting & Headers', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.post(
      '/api/v1/compile',
      rateLimiter({
        limit: 2,
        windowMs: 60000,
        strategyName: 'SlidingWindowCounter',
        identifier: 'apiKeyOrIp',
      }),
      (req, res) => res.json({ success: true })
    );
  });

  it('includes X-RateLimit-Reset header on rate-limited responses', async () => {
    await request(app).post('/api/v1/compile').expect(200);
    await request(app).post('/api/v1/compile').expect(200);
    const res = await request(app).post('/api/v1/compile');

    expect(res.status).toBe(429);
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('supports API Key identification from headers', async () => {
    // Verified keys get their own bucket (#1574).
    const keyed = express();
    keyed.post(
      '/api/v1/compile',
      rateLimiter({
        limit: 2,
        windowMs: 60000,
        strategyName: 'SlidingWindowCounter',
        identifier: 'apiKeyOrIp',
        scope: 'issue-1024-keyed',
        validateApiKey: async (key) =>
          key === 'test-api-key-123' ? { id: 'k-123', tier: 'free' } : null,
      }),
      (req, res) => res.json({ success: true })
    );

    const res = await request(keyed)
      .post('/api/v1/compile')
      .set('x-api-key', 'test-api-key-123');

    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('2');
  });

  it('does not let unverified API keys escape an exhausted IP bucket', async () => {
    // The previous tests exhausted this IP's bucket; a made-up key must not
    // mint a fresh one (#1574).
    const res = await request(app)
      .post('/api/v1/compile')
      .set('x-api-key', 'made-up-key');

    expect(res.status).toBe(429);
  });
});

describe('Issue #1029: Prometheus Metrics & Observability', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/metrics', metricsRouter);
  });

  it('exposes /metrics with active_compilation_jobs and http_errors_total', async () => {
    activeCompilationJobs.set(5);

    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('active_compilation_jobs 5');
    expect(res.text).toContain('http_errors_total');
  });
});

describe('Issue #1027: Soroban RPC Gas & Resource Footprint Estimator Endpoint', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/simulate', simulateRouter);
  });

  it('returns 400 if transactionXdr is missing', async () => {
    const res = await request(app).post('/api/v1/simulate/fee').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('computes gas and resource estimates for transaction XDR', async () => {
    const res = await request(app)
      .post('/api/v1/simulate/fee')
      .send({ transactionXdr: 'AAAAAgAAAAA...', network: 'testnet' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.cpuInstructions).toBeGreaterThan(0);
    expect(res.body.data.memoryBytes).toBeGreaterThan(0);
    expect(res.body.data.estimatedTotalFee).toBeDefined();
  });
});

describe('Issue #1026: Cryptographic Webhook Delivery & Signature Verification', () => {
  it('builds delivery headers including X-Soroban-Signature', () => {
    const headers = buildDeliveryHeaders(
      '{"event":"test"}',
      'secret123',
      'delivery-1'
    );
    expect(headers['X-Soroban-Signature']).toBeDefined();
    expect(headers['X-Soroban-Signature']).toContain('sha256=');
    expect(headers['X-Playground-Signature']).toBe(
      headers['X-Soroban-Signature']
    );
  });

  it('verifies valid HMAC-SHA256 signature', () => {
    const secret = 'super-secret-key-12345';
    const payload = JSON.stringify({
      event: 'contract.deployed',
      contract_id: 'C123',
    });
    const signature = generateSignature(payload, secret);

    const valid = verifySignature(payload, secret, signature);
    expect(valid).toBe(true);
  });

  it('rejects invalid signature', () => {
    const valid = verifySignature(
      '{"event":"test"}',
      'secret123',
      'sha256=invalid'
    );
    expect(valid).toBe(false);
  });
});
