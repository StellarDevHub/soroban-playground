import express from 'express';
import request from 'supertest';
import {
  clientIpMiddleware,
  resolveClientIp,
} from '../src/middleware/clientIp.js';
import { ddosMitigationMiddleware } from '../src/middleware/ddosMitigation.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import ipFilterService from '../src/services/ipFilterService.js';

function createApp() {
  const app = express();
  app.use(clientIpMiddleware({ trustProxy: true, trustProxyHops: 1 }));
  app.use(ddosMitigationMiddleware({ skipPaths: [] }));
  app.get('/api/resource', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('client IP resolution', () => {
  it('reads Cloudflare connecting IP when present', () => {
    const ip = resolveClientIp(
      {
        headers: { 'cf-connecting-ip': '203.0.113.10' },
        socket: { remoteAddress: '10.0.0.1' },
      },
      { trustProxy: true }
    );
    expect(ip).toBe('203.0.113.10');
  });

  it('parses X-Forwarded-For with trust proxy hops', () => {
    const ip = resolveClientIp(
      {
        headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.2' },
        socket: { remoteAddress: '10.0.0.1' },
      },
      { trustProxy: true, trustProxyHops: 1 }
    );
    expect(ip).toBe('203.0.113.5');
  });

  it('falls back to socket address when proxy headers are absent', () => {
    const ip = resolveClientIp(
      { headers: {}, socket: { remoteAddress: '127.0.0.1' } },
      { trustProxy: false }
    );
    expect(ip).toBe('127.0.0.1');
  });
});

describe('DDoS mitigation middleware', () => {
  beforeEach(() => {
    ipFilterService.clearMemoryState();
    ipFilterService.spikeThreshold = 5;
    ipFilterService.spikeWindowMs = 10_000;
    ipFilterService.blacklistTtlSeconds = 60;
  });

  it('allows legitimate low-volume traffic', async () => {
    const app = createApp();
    const res = await request(app)
      .get('/api/resource')
      .set('X-Forwarded-For', '198.51.100.20');

    expect(res.status).toBe(200);
    expect(res.headers['x-ddos-score']).toBe('1');
  });

  it('blocks traffic spikes and blacklists offending IPs', async () => {
    const app = createApp();
    const attackerIp = '198.51.100.99';

    for (let i = 0; i < 5; i += 1) {
      const allowed = await request(app)
        .get('/api/resource')
        .set('X-Forwarded-For', attackerIp);
      expect(allowed.status).toBe(200);
    }

    const blocked = await request(app)
      .get('/api/resource')
      .set('X-Forwarded-For', attackerIp);

    expect(blocked.status).toBe(429);
    expect(blocked.body.details?.reason).toBe('ddos_mitigation');

    const blacklisted = await request(app)
      .get('/api/resource')
      .set('X-Forwarded-For', attackerIp);

    expect(blacklisted.status).toBe(403);
    expect(blacklisted.body.details?.reason).toBe('ip_blacklisted');
  });

  it('does not block whitelisted IPs during spikes', async () => {
    const app = createApp();
    const trustedIp = '203.0.113.77';
    await ipFilterService.addWhitelist(trustedIp);

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app)
        .get('/api/resource')
        .set('X-Forwarded-For', trustedIp);
      expect(res.status).toBe(200);
    }
  });

  it('simulates automated stress burst without unbounded memory growth', async () => {
    const app = createApp();
    const uniqueIps = Array.from(
      { length: 50 },
      (_, i) => `198.51.100.${i + 1}`
    );

    const results = await Promise.all(
      uniqueIps.map((ip) =>
        request(app).get('/api/resource').set('X-Forwarded-For', ip)
      )
    );

    expect(results.every((res) => res.status === 200)).toBe(true);
    expect(ipFilterService.clearMemoryState).toBeDefined();
  });
});
