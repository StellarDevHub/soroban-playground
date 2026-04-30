// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Tests for /api/token-gated routes.
 * Uses an isolated Express app to avoid server.js startup side-effects.
 */

import express from 'express';
import request from 'supertest';
import tokenGatedRoute from '../../src/routes/tokenGatedAccess.js';

// Stub rateLimitMiddleware so tests don't need Redis
jest.mock('../../src/middleware/rateLimiter.js', () => ({
  rateLimitMiddleware: () => (_req, _res, next) => next(),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/token-gated', tokenGatedRoute);
  // Minimal error handler
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, message: err.message });
  });
  return app;
}

describe('Token-Gated Access API', () => {
  let app;

  beforeEach(() => {
    // Fresh module state per test suite run
    jest.resetModules();
    app = buildApp();
  });

  // ── Mint ──────────────────────────────────────────────────────────────────

  test('POST /mint creates a membership', async () => {
    const res = await request(app)
      .post('/api/token-gated/mint')
      .send({ admin: 'GADMIN', recipient: 'GUSER1', tier: 'Basic', metadataUri: 'ipfs://x' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tier).toBe('Basic');
    expect(res.body.data.tokenId).toBeGreaterThan(0);
  });

  test('POST /mint rejects missing recipient', async () => {
    const res = await request(app)
      .post('/api/token-gated/mint')
      .send({ admin: 'GADMIN', tier: 'Basic' });

    expect(res.status).toBe(400);
  });

  test('POST /mint rejects invalid tier', async () => {
    const res = await request(app)
      .post('/api/token-gated/mint')
      .send({ admin: 'GADMIN', recipient: 'GUSER2', tier: 'Gold' });

    expect(res.status).toBe(400);
  });

  // ── Access check ──────────────────────────────────────────────────────────

  test('GET /check-access returns false for unknown address', async () => {
    const res = await request(app)
      .get('/api/token-gated/check-access')
      .query({ address: 'GUNKNOWN', minTier: 'Basic' });

    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(false);
  });

  test('GET /check-access returns true for valid member', async () => {
    // Mint first
    await request(app)
      .post('/api/token-gated/mint')
      .send({ admin: 'GADMIN', recipient: 'GMEMBER', tier: 'Premium' });

    const res = await request(app)
      .get('/api/token-gated/check-access')
      .query({ address: 'GMEMBER', minTier: 'Basic' });

    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(true);
  });

  test('GET /check-access denies insufficient tier', async () => {
    await request(app)
      .post('/api/token-gated/mint')
      .send({ admin: 'GADMIN', recipient: 'GBASIC', tier: 'Basic' });

    const res = await request(app)
      .get('/api/token-gated/check-access')
      .query({ address: 'GBASIC', minTier: 'Elite' });

    expect(res.status).toBe(200);
    expect(res.body.data.granted).toBe(false);
    expect(res.body.data.reason).toBe('insufficient_tier');
  });

  // ── Analytics ─────────────────────────────────────────────────────────────

  test('GET /analytics returns analytics object', async () => {
    const res = await request(app).get('/api/token-gated/analytics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.totalMembers).toBe('number');
  });

  // ── Members list ──────────────────────────────────────────────────────────

  test('GET /members returns paginated list', async () => {
    const res = await request(app).get('/api/token-gated/members');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  // ── Revoke ────────────────────────────────────────────────────────────────

  test('DELETE /revoke/:tokenId removes membership', async () => {
    const mintRes = await request(app)
      .post('/api/token-gated/mint')
      .send({ admin: 'GADMIN', recipient: 'GREVOKE', tier: 'Basic' });

    const tokenId = mintRes.body.data.tokenId;
    const revokeRes = await request(app).delete(`/api/token-gated/revoke/${tokenId}`);
    expect(revokeRes.status).toBe(200);

    // Access should now be denied
    const checkRes = await request(app)
      .get('/api/token-gated/check-access')
      .query({ address: 'GREVOKE', minTier: 'Basic' });
    expect(checkRes.body.data.granted).toBe(false);
  });

  // ── Upgrade ───────────────────────────────────────────────────────────────

  test('PATCH /upgrade/:tokenId upgrades tier', async () => {
    const mintRes = await request(app)
      .post('/api/token-gated/mint')
      .send({ admin: 'GADMIN', recipient: 'GUPGRADE', tier: 'Basic' });

    const tokenId = mintRes.body.data.tokenId;
    const upgradeRes = await request(app)
      .patch(`/api/token-gated/upgrade/${tokenId}`)
      .send({ newTier: 'Elite' });

    expect(upgradeRes.status).toBe(200);
    expect(upgradeRes.body.data.tier).toBe('Elite');
  });
});
