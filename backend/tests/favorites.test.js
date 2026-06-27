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
const { default: favoritesRouter } = await import('../src/routes/favorites.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');
const { default: apiKeyService } =
  await import('../src/services/apiKeyService.js');

const app = express();
app.use(express.json());
app.use('/api/favorites', favoritesRouter);
app.use(errorHandler);

const WALLET = 'GABCDEF12345678901234567890';
let tenantAKey;
let tenantBKey;

describe('Favorites API', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await testDb.run('DELETE FROM favorites');
    await testDb.run('DELETE FROM rate_limit_usage');
    await testDb.run('DELETE FROM audit_log');
    await testDb.run('DELETE FROM api_keys');

    tenantAKey = await apiKeyService.generateKey({
      name: 'Tenant A',
      userId: 1,
      organizationId: 101,
    });
    tenantBKey = await apiKeyService.generateKey({
      name: 'Tenant B',
      userId: 2,
      organizationId: 202,
    });
  });

  describe('GET /api/favorites', () => {
    it('returns 401 if no tenant credential is provided', async () => {
      const res = await request(app).get('/api/favorites');
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/tenant authentication required/i);
    });

    it('returns 401 if no x-wallet-address header', async () => {
      const res = await request(app)
        .get('/api/favorites')
        .set('x-api-key', tenantAKey.key);

      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/authentication required/i);
    });

    it('returns empty favorites for a new wallet', async () => {
      const res = await request(app)
        .get('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET);

      expect(res.status).toBe(200);
      expect(res.body.favorites).toEqual([]);
      expect(res.body).toHaveProperty('updatedAt');
    });

    it('returns stored favorites for an existing wallet', async () => {
      await testDb.run(
        'INSERT INTO favorites (tenant_id, wallet_address, favorites, updated_at) VALUES (?, ?, ?, ?)',
        [
          tenantAKey.tenantId,
          WALLET,
          JSON.stringify(['a', 'b', 'c']),
          new Date().toISOString(),
        ]
      );

      const res = await request(app)
        .get('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET);

      expect(res.status).toBe(200);
      expect(res.body.favorites).toEqual(['a', 'b', 'c']);
    });
  });

  describe('POST /api/favorites', () => {
    it('returns 401 if no x-wallet-address header', async () => {
      const res = await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .send({ favorites: ['a'] });

      expect(res.status).toBe(401);
    });

    it('returns 400 if favorites is not an array of strings', async () => {
      const res = await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET)
        .send({ favorites: 'not-an-array' });

      expect(res.status).toBe(400);
    });

    it('stores favorites and returns them with updatedAt', async () => {
      const res = await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET)
        .send({ favorites: ['a', 'b', 'c'] });

      expect(res.status).toBe(200);
      expect(res.body.favorites).toEqual(['a', 'b', 'c']);
      expect(res.body).toHaveProperty('updatedAt');

      const row = await testDb.get(
        'SELECT * FROM favorites WHERE tenant_id = ? AND wallet_address = ?',
        [tenantAKey.tenantId, WALLET]
      );
      expect(row).toBeTruthy();
      expect(JSON.parse(row.favorites)).toEqual(['a', 'b', 'c']);
    });

    it('upserts favorites for the same wallet', async () => {
      await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET)
        .send({ favorites: ['a', 'b'] });

      const res = await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET)
        .send({ favorites: ['c'] });

      expect(res.status).toBe(200);
      expect(res.body.favorites).toEqual(['c']);

      const rows = await testDb.all(
        'SELECT * FROM favorites WHERE tenant_id = ? AND wallet_address = ?',
        [tenantAKey.tenantId, WALLET]
      );
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].favorites)).toEqual(['c']);
    });

    it('isolates favorites per wallet', async () => {
      const walletA = 'WALLET_A';
      const walletB = 'WALLET_B';

      await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', walletA)
        .send({ favorites: ['from-a'] });

      await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', walletB)
        .send({ favorites: ['from-b'] });

      const resA = await request(app)
        .get('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', walletA);

      const resB = await request(app)
        .get('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', walletB);

      expect(resA.body.favorites).toEqual(['from-a']);
      expect(resB.body.favorites).toEqual(['from-b']);
    });

    it('isolates the same wallet address across tenants', async () => {
      await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET)
        .send({ favorites: ['tenant-a'] });

      await request(app)
        .post('/api/favorites')
        .set('x-api-key', tenantBKey.key)
        .set('x-wallet-address', WALLET)
        .send({ favorites: ['tenant-b'] });

      const resA = await request(app)
        .get('/api/favorites')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET);

      const resB = await request(app)
        .get('/api/favorites')
        .set('x-api-key', tenantBKey.key)
        .set('x-wallet-address', WALLET);

      expect(resA.body.favorites).toEqual(['tenant-a']);
      expect(resB.body.favorites).toEqual(['tenant-b']);
    });
  });
});
