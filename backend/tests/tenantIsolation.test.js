// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs/promises';
import path from 'path';

let testDb = null;

jest.unstable_mockModule('../src/database/connection.js', () => ({
  initializeDatabase: async () => {
    if (testDb) return testDb;
    testDb = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    const schemaPath = path.resolve(process.cwd(), 'src/database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    await testDb.exec(schema);

    return testDb;
  },
  getDatabase: () => {
    if (!testDb) {
      throw new Error(
        'Database not initialized. Call initializeDatabase() first.'
      );
    }
    return testDb;
  },
  closeDatabase: async () => {
    if (testDb) {
      await testDb.close();
      testDb = null;
    }
  },
}));

const { initializeDatabase, closeDatabase } =
  await import('../src/database/connection.js');

import express from 'express';
import request from 'supertest';

const { default: webhooksRouter } = await import('../src/routes/webhooks.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { default: apiKeyService } =
  await import('../src/services/apiKeyService.js');
const { default: searchService } =
  await import('../src/services/searchService.js');

const app = express();
app.use(express.json());
app.use('/api/webhooks', webhooksRouter);
app.use(errorHandler);

describe('multi-tenant isolation', () => {
  let tenantAKey;
  let tenantBKey;

  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await testDb.run('DELETE FROM webhook_deliveries');
    await testDb.run('DELETE FROM webhook_subscriptions');
    await testDb.run('DELETE FROM search_analytics');
    await testDb.run('DELETE FROM popular_searches');
    await testDb.run('DELETE FROM projects');
    await testDb.run('DELETE FROM rate_limit_usage');
    await testDb.run('DELETE FROM audit_log');
    await testDb.run('DELETE FROM api_keys');

    tenantAKey = await apiKeyService.generateKey({
      name: 'Tenant A',
      userId: 11,
      organizationId: 1001,
    });
    tenantBKey = await apiKeyService.generateKey({
      name: 'Tenant B',
      userId: 22,
      organizationId: 2002,
    });
  });

  it('rejects tenant-owned routes without authenticated tenant context', async () => {
    const res = await request(app).get('/api/webhooks');

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/tenant authentication required/i);
  });

  it('only returns webhook subscriptions owned by the active tenant', async () => {
    const createA = await request(app)
      .post('/api/webhooks')
      .set('x-api-key', tenantAKey.key)
      .send({
        url: 'https://tenant-a.example/hook',
        events: ['deploy.completed'],
        secret: 'tenant-a-secret-value',
      });

    const createB = await request(app)
      .post('/api/webhooks')
      .set('x-api-key', tenantBKey.key)
      .send({
        url: 'https://tenant-b.example/hook',
        events: ['deploy.completed'],
        secret: 'tenant-b-secret-value',
      });

    expect(createA.status).toBe(201);
    expect(createB.status).toBe(201);

    const resA = await request(app)
      .get('/api/webhooks')
      .set('x-api-key', tenantAKey.key);
    const resB = await request(app)
      .get('/api/webhooks')
      .set('x-api-key', tenantBKey.key);

    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].url).toBe('https://tenant-a.example/hook');
    expect(resA.body.data[0].tenant_id).toBe(tenantAKey.tenantId);
    expect(resB.body.data).toHaveLength(1);
    expect(resB.body.data[0].url).toBe('https://tenant-b.example/hook');
    expect(resB.body.data[0].tenant_id).toBe(tenantBKey.tenantId);
  });

  it('prevents deleting another tenant webhook subscription by id', async () => {
    const created = await request(app)
      .post('/api/webhooks')
      .set('x-api-key', tenantAKey.key)
      .send({
        url: 'https://tenant-a.example/hook',
        events: ['*'],
        secret: 'tenant-a-secret-value',
      });

    const crossTenantDelete = await request(app)
      .delete(`/api/webhooks/${created.body.data.id}`)
      .set('x-api-key', tenantBKey.key);

    expect(crossTenantDelete.status).toBe(404);

    const row = await testDb.get(
      'SELECT id FROM webhook_subscriptions WHERE id = ? AND tenant_id = ?',
      [created.body.data.id, tenantAKey.tenantId]
    );
    expect(row).toBeTruthy();
  });

  it('enqueues and lists webhook deliveries only for the active tenant', async () => {
    await request(app)
      .post('/api/webhooks')
      .set('x-api-key', tenantAKey.key)
      .send({
        url: 'https://tenant-a.example/hook',
        events: ['deploy.completed'],
        secret: 'tenant-a-secret-value',
      });
    await request(app)
      .post('/api/webhooks')
      .set('x-api-key', tenantBKey.key)
      .send({
        url: 'https://tenant-b.example/hook',
        events: ['deploy.completed'],
        secret: 'tenant-b-secret-value',
      });

    const dispatchA = await request(app)
      .post('/api/webhooks/dispatch')
      .set('x-api-key', tenantAKey.key)
      .send({ event_type: 'deploy.completed', payload: { id: 'tx-a' } });

    expect(dispatchA.status).toBe(202);
    expect(dispatchA.body.data.enqueued).toBe(1);

    const resA = await request(app)
      .get('/api/webhooks/deliveries')
      .set('x-api-key', tenantAKey.key);
    const resB = await request(app)
      .get('/api/webhooks/deliveries')
      .set('x-api-key', tenantBKey.key);

    expect(resA.body.data).toHaveLength(1);
    expect(resA.body.data[0].event_type).toBe('deploy.completed');
    expect(resB.body.data).toHaveLength(0);
  });

  it('filters search results and search analytics by tenant_id', async () => {
    await searchService.initialize();

    await testDb.run(
      `INSERT INTO projects
       (tenant_id, title, description, category, status, creator_id, creator_name, funding_goal, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantAKey.tenantId,
        'Alpha Wallet',
        'Tenant A project',
        'Tools',
        'active',
        11,
        'Tenant A',
        1000,
        '["alpha"]',
      ]
    );
    await testDb.run(
      `INSERT INTO projects
       (tenant_id, title, description, category, status, creator_id, creator_name, funding_goal, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tenantBKey.tenantId,
        'Alpha Wallet',
        'Tenant B project',
        'Tools',
        'active',
        22,
        'Tenant B',
        1000,
        '["alpha"]',
      ]
    );

    const resultsA = await searchService.searchProjects(
      'Alpha',
      {},
      {},
      tenantAKey.tenantId
    );
    const resultsB = await searchService.searchProjects(
      'Alpha',
      {},
      {},
      tenantBKey.tenantId
    );

    expect(resultsA.results).toHaveLength(1);
    expect(resultsA.results[0].creator_name).toBe('Tenant A');
    expect(resultsB.results).toHaveLength(1);
    expect(resultsB.results[0].creator_name).toBe('Tenant B');

    const analyticsA = await testDb.get(
      'SELECT COUNT(*) as count FROM search_analytics WHERE tenant_id = ?',
      [tenantAKey.tenantId]
    );
    const popularA = await searchService.getPopularSearches(
      10,
      tenantAKey.tenantId
    );

    expect(analyticsA.count).toBe(1);
    expect(popularA).toHaveLength(1);
    expect(popularA[0].query).toBe('Alpha');
  });
});
