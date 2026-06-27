import express from 'express';
import request from 'supertest';
import applySecurityHeaders, {
  buildHelmetMiddleware,
  createCspNonce,
} from '../src/middleware/securityHeaders.js';
import {
  createHttpError,
  errorHandler,
  notFoundHandler,
} from '../src/middleware/errorHandler.js';

function createTestApp() {
  const app = express();
  applySecurityHeaders(app);
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/error', () => {
    throw createHttpError(500, 'Simulated failure');
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function expectSecurityHeaders(res) {
  expect(res.headers['x-powered-by']).toBeUndefined();
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['strict-transport-security']).toContain(
    'max-age=63072000'
  );
  expect(res.headers['strict-transport-security']).toContain(
    'includeSubDomains'
  );
  expect(res.headers['strict-transport-security']).toContain('preload');
  expect(res.headers['content-security-policy']).toBeDefined();
  expect(res.headers['content-security-policy']).toContain("'self'");
  expect(res.headers['referrer-policy']).toBe(
    'strict-origin-when-cross-origin'
  );
  expect(res.headers['x-csp-nonce']).toBeDefined();
  expect(res.headers['content-security-policy']).toContain(
    `'nonce-${res.headers['x-csp-nonce']}'`
  );
}

describe('Helmet security headers middleware', () => {
  it('applies hardened headers on successful REST responses', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/ping');

    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });

  it('applies hardened headers on 404 error responses', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/missing-route');

    expect(res.status).toBe(404);
    expectSecurityHeaders(res);
  });

  it('applies hardened headers on 500 error responses', async () => {
    const app = createTestApp();
    const res = await request(app).get('/api/error');

    expect(res.status).toBe(500);
    expectSecurityHeaders(res);
  });

  it('generates a unique CSP nonce per request', async () => {
    const app = createTestApp();
    const first = await request(app).get('/api/ping');
    const second = await request(app).get('/api/ping');

    expect(first.headers['x-csp-nonce']).toBeDefined();
    expect(second.headers['x-csp-nonce']).toBeDefined();
    expect(first.headers['x-csp-nonce']).not.toBe(
      second.headers['x-csp-nonce']
    );
  });

  it('exports composable middleware building blocks', () => {
    expect(typeof createCspNonce).toBe('function');
    expect(typeof buildHelmetMiddleware()).toBe('function');
  });
});
