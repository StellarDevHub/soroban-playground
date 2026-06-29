// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import { ServiceRegistry, registerSelf } from '../src/services/serviceRegistry.js';
import registryRouter from '../src/routes/serviceRegistry.js';

// ── ServiceRegistry unit tests ────────────────────────────────────────────────

describe('ServiceRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ServiceRegistry({ ttlMs: 500 });
  });

  afterEach(() => {
    registry.stopPruning();
  });

  it('registers an instance and lists it', () => {
    registry.register({ name: 'svc', instanceId: 'i1', host: 'localhost', port: 3001 });
    const list = registry.list('svc');
    expect(list).toHaveLength(1);
    expect(list[0].instanceId).toBe('i1');
  });

  it('listServices returns registered service names', () => {
    registry.register({ name: 'svc-a', instanceId: 'a1', host: 'h', port: 1 });
    registry.register({ name: 'svc-b', instanceId: 'b1', host: 'h', port: 2 });
    expect(registry.listServices()).toContain('svc-a');
    expect(registry.listServices()).toContain('svc-b');
  });

  it('lookup returns a healthy instance', () => {
    registry.register({ name: 'svc', instanceId: 'i1', host: 'localhost', port: 3001 });
    const result = registry.lookup('svc');
    expect(result).not.toBeNull();
    expect(result.instanceId).toBe('i1');
    expect(result.host).toBe('localhost');
    expect(result.port).toBe(3001);
  });

  it('lookup returns null for unknown service', () => {
    expect(registry.lookup('unknown')).toBeNull();
  });

  it('deregister removes the instance', () => {
    registry.register({ name: 'svc', instanceId: 'i1', host: 'h', port: 1 });
    registry.deregister('svc', 'i1');
    expect(registry.list('svc')).toHaveLength(0);
    expect(registry.lookup('svc')).toBeNull();
  });

  it('heartbeat updates lastHeartbeat', () => {
    registry.register({ name: 'svc', instanceId: 'i1', host: 'h', port: 1 });
    const before = registry.list('svc')[0].lastHeartbeat;
    jest.advanceTimersByTime?.(10);
    registry.heartbeat('svc', 'i1');
    const after = registry.list('svc')[0].lastHeartbeat;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('throws if heartbeat is called for unknown instance', () => {
    expect(() => registry.heartbeat('svc', 'no-such')).toThrow(/Unknown instance/);
  });

  it('throws if required register fields are missing', () => {
    expect(() => registry.register({ name: 'svc', instanceId: 'i1', host: 'h' })).toThrow(
      /required/,
    );
  });

  it('prunes stale instance after TTL expires', async () => {
    const pruned = [];
    const r = new ServiceRegistry({ ttlMs: 50 });
    r.on('pruned', (e) => pruned.push(e));
    r.register({ name: 'svc', instanceId: 'stale', host: 'h', port: 1 });

    await new Promise((resolve) => setTimeout(resolve, 150));
    // After TTL, the instance should be gone
    expect(r.list('svc')).toHaveLength(0);
    expect(pruned[0]?.instanceId).toBe('stale');
    r.stopPruning();
  }, 500);

  it('emits registered and deregistered events', () => {
    const events = [];
    registry.on('registered', (e) => events.push({ type: 'reg', ...e }));
    registry.on('deregistered', (e) => events.push({ type: 'dereg', ...e }));
    registry.register({ name: 'svc', instanceId: 'i1', host: 'h', port: 1 });
    registry.deregister('svc', 'i1');
    expect(events[0].type).toBe('reg');
    expect(events[1].type).toBe('dereg');
  });
});

describe('registerSelf', () => {
  it('registers and starts heartbeat, stop() deregisters', () => {
    const registry = new ServiceRegistry();
    const { instanceId, stop } = registerSelf({
      registry,
      name: 'test-svc',
      instanceId: 'test-1',
      host: 'localhost',
      port: 4000,
      heartbeatIntervalMs: 5000,
    });
    expect(instanceId).toBe('test-1');
    expect(registry.lookup('test-svc')).not.toBeNull();
    stop();
    expect(registry.lookup('test-svc')).toBeNull();
    registry.stopPruning();
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('Service Registry HTTP routes', () => {
  let app;
  let testRegistry;

  beforeAll(() => {
    // Override module-level singleton with a fresh one for test isolation
    testRegistry = new ServiceRegistry();
    app = express();
    app.use(express.json());

    // Mount with a fresh registry by patching the route module's import
    // We use the shared singleton here (simpler for route tests)
    app.use('/api/registry', registryRouter);
  });

  afterAll(() => {
    testRegistry.stopPruning();
  });

  it('GET /api/registry/services returns array', async () => {
    const res = await request(app).get('/api/registry/services');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('POST /api/registry/register creates an instance', async () => {
    const res = await request(app).post('/api/registry/register').send({
      name: 'e2e-svc',
      instanceId: 'e2e-1',
      host: 'localhost',
      port: 9001,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.instanceId).toBe('e2e-1');
  });

  it('GET /api/registry/services/e2e-svc lists the registered instance', async () => {
    const res = await request(app).get('/api/registry/services/e2e-svc');
    expect(res.status).toBe(200);
    expect(res.body.data.some((i) => i.instanceId === 'e2e-1')).toBe(true);
  });

  it('GET /api/registry/services/e2e-svc/resolve returns the instance', async () => {
    const res = await request(app).get('/api/registry/services/e2e-svc/resolve');
    expect(res.status).toBe(200);
    expect(res.body.data.instanceId).toBe('e2e-1');
  });

  it('GET /api/registry/services/unknown/resolve returns 404', async () => {
    const res = await request(app).get('/api/registry/services/unknown/resolve');
    expect(res.status).toBe(404);
  });

  it('POST /api/registry/heartbeat returns 200', async () => {
    const res = await request(app).post('/api/registry/heartbeat').send({
      name: 'e2e-svc',
      instanceId: 'e2e-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /api/registry/services/:name/:id deregisters instance', async () => {
    const res = await request(app).delete('/api/registry/services/e2e-svc/e2e-1');
    expect(res.status).toBe(200);
  });

  it('POST /api/registry/register returns 400 for missing fields', async () => {
    const res = await request(app).post('/api/registry/register').send({ name: 'x' });
    expect(res.status).toBe(400);
  });
});
