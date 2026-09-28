/**
 * backend/tests/workspace.test.js
 *
 * Workspace cloud sync API — issue #1526.
 *
 * Covers the merge contract the client relies on: favorites are unioned, the
 * history log is appended, the workspace document is last-write-wins, and a
 * stale `baseRevision` is rejected with 409 so the client can merge instead of
 * clobbering.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

let mockDb = null;

jest.mock('../src/database/connection.js', () => ({
  initializeDatabase: async () => {
    const sqlite3 = require('sqlite3');
    const { open } = require('sqlite');
    const fs = require('fs/promises');
    const path = require('path');
    if (mockDb) return mockDb;
    mockDb = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    const schemaPath = path.resolve(process.cwd(), 'src/database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    await mockDb.exec(schema);

    return mockDb;
  },
  getDatabase: () => {
    if (!mockDb) {
      throw new Error(
        'Database not initialized. Call initializeDatabase() first.'
      );
    }
    return mockDb;
  },
  closeDatabase: async () => {
    if (mockDb) {
      await mockDb.close();
      mockDb = null;
    }
  },
}));

const {
  initializeDatabase,
  closeDatabase,
} = require('../src/database/connection.js');

const { default: workspaceRouter } = require('../src/routes/workspace.js');
const { errorHandler } = require('../src/middleware/errorHandler.js');
const { default: apiKeyService } = require('../src/services/apiKeyService.js');

const app = express();
app.use(express.json());
app.use('/api/workspace', workspaceRouter);
app.use(errorHandler);

// 56-char Stellar strkey (G + 55 base32 chars).
const WALLET_A = `G${'A'.repeat(55)}`;
const WALLET_B = `G${'B'.repeat(55)}`;

let tenantAKey;
let tenantBKey;

function post(body, { wallet = WALLET_A, key = tenantAKey } = {}) {
  return request(app)
    .post('/api/workspace')
    .set('x-api-key', key)
    .set('x-wallet-address', wallet)
    .send(body);
}

function get(wallet = WALLET_A, key = tenantAKey) {
  return request(app)
    .get('/api/workspace')
    .set('x-api-key', key)
    .set('x-wallet-address', wallet);
}

describe('Workspace sync API', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    await mockDb.run('DELETE FROM workspace_snapshots');
    await mockDb.run('DELETE FROM rate_limit_usage');
    await mockDb.run('DELETE FROM audit_log');
    await mockDb.run('DELETE FROM api_keys');

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

  describe('authentication', () => {
    it('rejects a request with no tenant credential', async () => {
      const res = await request(app).get('/api/workspace');
      expect(res.status).toBe(401);
    });

    it('rejects a request with no x-wallet-address header', async () => {
      const res = await request(app)
        .get('/api/workspace')
        .set('x-api-key', tenantAKey.key);
      expect(res.status).toBe(401);
    });

    it('rejects a malformed Stellar address', async () => {
      const res = await get('not-a-stellar-address');
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/invalid stellar public key/i);
    });
  });

  describe('GET /api/workspace', () => {
    it('returns an empty snapshot for an unseen wallet', async () => {
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.body.data.favorites).toEqual([]);
      expect(res.body.data.history).toEqual([]);
      expect(res.body.data.revision).toBe(0);
    });

    it('returns a previously stored snapshot', async () => {
      await post({ favorites: ['counter'], updatedAt: 1_000, deviceId: 'aa' });

      const res = await get();
      expect(res.status).toBe(200);
      expect(res.body.data.favorites).toEqual(['counter']);
      expect(res.body.data.revision).toBe(1);
    });
  });

  describe('POST /api/workspace merge semantics', () => {
    it('unions favorites instead of replacing them', async () => {
      await post({ favorites: ['counter'], updatedAt: 1_000, deviceId: 'aa' });
      await post({ favorites: ['escrow'], updatedAt: 2_000, deviceId: 'bb' });

      const res = await get();
      expect(res.body.data.favorites).toEqual(['counter', 'escrow']);
    });

    it('deduplicates favorites', async () => {
      await post({ favorites: ['counter', 'escrow'], updatedAt: 1_000 });
      await post({ favorites: ['escrow', 'token'], updatedAt: 2_000 });

      const res = await get();
      expect(res.body.data.favorites).toEqual(['counter', 'escrow', 'token']);
    });

    it('appends history entries and orders them oldest first', async () => {
      await post({
        history: [
          { id: 'h2', at: 200, kind: 'deploy', label: 'second' },
          { id: 'h1', at: 100, kind: 'compile', label: 'first' },
        ],
        updatedAt: 1_000,
      });
      await post({
        history: [{ id: 'h3', at: 300, kind: 'invoke', label: 'third' }],
        updatedAt: 2_000,
      });

      const res = await get();
      expect(res.body.data.history.map((entry) => entry.id)).toEqual([
        'h1',
        'h2',
        'h3',
      ]);
    });

    it('replaces a history entry with the same id rather than duplicating it', async () => {
      await post({
        history: [{ id: 'h1', at: 100, kind: 'compile', label: 'first' }],
        updatedAt: 1_000,
      });
      await post({
        history: [{ id: 'h1', at: 100, kind: 'compile', label: 'renamed' }],
        updatedAt: 2_000,
      });

      const res = await get();
      expect(res.body.data.history).toHaveLength(1);
      expect(res.body.data.history[0].label).toBe('renamed');
    });

    it('keeps the newer workspace document', async () => {
      await post({
        workspace: { fontSize: 12 },
        updatedAt: 1_000,
        deviceId: 'aa',
      });
      await post({
        workspace: { fontSize: 18 },
        updatedAt: 2_000,
        deviceId: 'bb',
      });

      const res = await get();
      expect(res.body.data.workspace.fontSize).toBe(18);
    });

    it('ignores an older workspace document', async () => {
      await post({
        workspace: { fontSize: 18 },
        updatedAt: 5_000,
        deviceId: 'aa',
      });
      await post({
        workspace: { fontSize: 10 },
        updatedAt: 1_000,
        deviceId: 'bb',
      });

      const res = await get();
      expect(res.body.data.workspace.fontSize).toBe(18);
    });

    it('increments the revision on every write', async () => {
      await post({ favorites: ['a'], updatedAt: 1_000 });
      const res = await post({ favorites: ['b'], updatedAt: 2_000 });
      expect(res.body.data.revision).toBe(2);
    });

    it('answers 409 with the current snapshot when baseRevision is stale', async () => {
      await post({ favorites: ['a'], updatedAt: 1_000 });

      const res = await post({
        favorites: ['b'],
        updatedAt: 2_000,
        baseRevision: 0,
      });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/stale/i);
      expect(res.body.details.current.favorites).toEqual(['a']);
    });

    it('accepts a matching baseRevision', async () => {
      const first = await post({ favorites: ['a'], updatedAt: 1_000 });
      const res = await post({
        favorites: ['b'],
        updatedAt: 2_000,
        baseRevision: first.body.data.revision,
      });
      expect(res.status).toBe(200);
      expect(res.body.data.favorites).toEqual(['a', 'b']);
    });

    it('strips unknown workspace keys', async () => {
      await post({
        workspace: { fontSize: 16, __proto__: { polluted: true }, evil: 'x' },
        updatedAt: 1_000,
      });

      const res = await get();
      expect(res.body.data.workspace.fontSize).toBe(16);
      expect(res.body.data.workspace.evil).toBeUndefined();
    });
  });

  describe('tenant / wallet isolation', () => {
    it('isolates snapshots per wallet', async () => {
      await post({ favorites: ['from-a'] }, { wallet: WALLET_A });
      await post({ favorites: ['from-b'] }, { wallet: WALLET_B });

      const resA = await get(WALLET_A);
      const resB = await get(WALLET_B);
      expect(resA.body.data.favorites).toEqual(['from-a']);
      expect(resB.body.data.favorites).toEqual(['from-b']);
    });

    it('isolates the same wallet address across tenants', async () => {
      await post({ favorites: ['tenant-a'] }, { key: tenantAKey });
      await post({ favorites: ['tenant-b'] }, { key: tenantBKey });

      const resA = await get(WALLET_A, tenantAKey);
      const resB = await get(WALLET_A, tenantBKey);
      expect(resA.body.data.favorites).toEqual(['tenant-a']);
      expect(resB.body.data.favorites).toEqual(['tenant-b']);
    });
  });

  describe('GET /api/workspace/history', () => {
    it('returns history newest-first and honours the limit', async () => {
      await post({
        history: [
          { id: 'h1', at: 100, kind: 'compile', label: 'first' },
          { id: 'h2', at: 200, kind: 'deploy', label: 'second' },
          { id: 'h3', at: 300, kind: 'invoke', label: 'third' },
        ],
        updatedAt: 1_000,
      });

      const res = await request(app)
        .get('/api/workspace/history?limit=2')
        .set('x-api-key', tenantAKey.key)
        .set('x-wallet-address', WALLET_A);

      expect(res.status).toBe(200);
      expect(res.body.data.history.map((entry) => entry.id)).toEqual([
        'h3',
        'h2',
      ]);
    });

    it('requires authentication', async () => {
      const res = await request(app).get('/api/workspace/history');
      expect(res.status).toBe(401);
    });
  });
});
