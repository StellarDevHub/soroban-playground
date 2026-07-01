import express from 'express';
import request from 'supertest';
import {
  clearHealthCache,
  dependencyCheckers,
  getHttpStatusForHealth,
  getLivenessPayload,
  performDeepHealthCheck,
  resetDependencyCheckers,
} from '../src/services/healthService.js';

const healthySqlite = () =>
  Promise.resolve({
    name: 'sqlite',
    status: 'healthy',
    latencyMs: 2,
    readable: true,
    writable: true,
    message: 'SQLite read/write OK',
  });

const healthyRedis = () =>
  Promise.resolve({
    name: 'redis',
    status: 'healthy',
    latencyMs: 1,
    mode: 'cluster',
    ping: 'PONG',
    message: 'Redis ping OK',
  });

const healthySorobanRpc = () =>
  Promise.resolve({
    name: 'sorobanRpc',
    status: 'healthy',
    latencyMs: 5,
    endpoint: 'https://soroban-testnet.stellar.org',
    message: 'Soroban RPC reachable',
  });

function installHealthyCheckers() {
  dependencyCheckers.sqlite = healthySqlite;
  dependencyCheckers.redis = healthyRedis;
  dependencyCheckers.sorobanRpc = healthySorobanRpc;
}

import healthRouter from '../src/routes/health.js';

function createHealthApp() {
  const app = express();
  app.use('/health', healthRouter);
  return app;
}

describe('Health Service', () => {
  beforeEach(() => {
    clearHealthCache();
    resetDependencyCheckers();
    installHealthyCheckers();
  });

  describe('liveness probe', () => {
    it('returns quickly without dependency checks', () => {
      const start = Date.now();
      const payload = getLivenessPayload();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(200);
      expect(payload.status).toBe('ok');
      expect(payload.probe).toBe('liveness');
      expect(payload).toHaveProperty('timestamp');
      expect(payload).toHaveProperty('uptime');
    });

    it('GET /health/live returns liveness payload', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/health/live');

      expect(res.status).toBe(200);
      expect(res.body.data.probe).toBe('liveness');
      expect(res.body.data.status).toBe('ok');
    });
  });

  describe('deep health check', () => {
    it('returns dependency details when all services are healthy', async () => {
      const result = await performDeepHealthCheck({ skipCache: true });

      expect(result.status).toBe('ok');
      expect(result.probe).toBe('readiness');
      expect(result.dependencies.sqlite.status).toBe('healthy');
      expect(result.dependencies.redis.status).toBe('healthy');
      expect(result.dependencies.sorobanRpc.status).toBe('healthy');
      expect(result).toHaveProperty('dependencyUptime');
      expect(result).toHaveProperty('timestamp');
      expect(result).toHaveProperty('uptime');
    });

    it('caches results for subsequent requests', async () => {
      const first = await performDeepHealthCheck({ skipCache: true });
      const second = await performDeepHealthCheck();

      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.timestamp).toBe(first.timestamp);
    });

    it('bypasses cache when skipCache is true', async () => {
      await performDeepHealthCheck({ skipCache: true });
      const refreshed = await performDeepHealthCheck({ skipCache: true });
      expect(refreshed.cached).toBe(false);
    });

    it('returns 503 HTTP status when sqlite fails', async () => {
      dependencyCheckers.sqlite = () =>
        Promise.resolve({
          name: 'sqlite',
          status: 'unhealthy',
          latencyMs: 1,
          readable: false,
          writable: false,
          message: 'DB connection lost',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.status).toBe('unhealthy');
      expect(result.dependencies.sqlite.status).toBe('unhealthy');
      expect(getHttpStatusForHealth(result.status)).toBe(503);
    });

    it('returns unhealthy when redis ping fails', async () => {
      dependencyCheckers.redis = () =>
        Promise.resolve({
          name: 'redis',
          status: 'unhealthy',
          latencyMs: 1,
          mode: 'cluster',
          message: 'Connection refused',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.dependencies.redis.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy');
    });

    it('returns unhealthy when Soroban RPC is unreachable', async () => {
      dependencyCheckers.sorobanRpc = () =>
        Promise.resolve({
          name: 'sorobanRpc',
          status: 'unhealthy',
          latencyMs: 1,
          endpoint: 'https://soroban-testnet.stellar.org',
          message: 'RPC timeout',
        });

      const result = await performDeepHealthCheck({ skipCache: true });
      expect(result.dependencies.sorobanRpc.status).toBe('unhealthy');
      expect(result.status).toBe('unhealthy');
    });
  });

  describe('GET /health endpoint', () => {
    it('returns 200 when dependencies are healthy', async () => {
      const app = createHealthApp();
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('dependencies');
      expect(res.body.data).toHaveProperty('status');
    });

    it('returns 503 when a core dependency fails', async () => {
      dependencyCheckers.sorobanRpc = () =>
        Promise.resolve({
          name: 'sorobanRpc',
          status: 'unhealthy',
          latencyMs: 1,
          endpoint: 'https://soroban-testnet.stellar.org',
          message: 'RPC down',
        });
      clearHealthCache();

      const app = createHealthApp();
      const res = await request(app).get('/health?refresh=true');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.data.status).toBe('unhealthy');
    });
  });
