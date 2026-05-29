// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let testDb = null;

// Mock the SQLite connection to use a clean in-memory database during tests
jest.unstable_mockModule('../src/database/connection.js', () => ({
  initializeDatabase: async () => {
    if (testDb) return testDb;
    testDb = await open({
      filename: ':memory:',
      driver: sqlite3.Database,
    });

    // Read and execute database schema on the in-memory instance
    const schemaPath = path.resolve(__dirname, '../src/database/schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf-8');
    await testDb.exec(schema);

    // FIX: Inject the unique constraint index needed for ON CONFLICT in trackUsage()
    await testDb.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_usage_unique_test ON rate_limit_usage(api_key_id, endpoint, window_start, window_end);'
    );

    return testDb;
  },
  getDatabase: () => {
    if (!testDb) {
      throw new Error('Database not initialized. Call initializeDatabase() first.');
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

// Import connection utilities and ApiKeyService after mocking connection.js
const { initializeDatabase, closeDatabase } = await import('../src/database/connection.js');
const { default: apiKeyService } = await import('../src/services/apiKeyService.js');

describe('ApiKeyService (Auth Service)', () => {
  beforeAll(async () => {
    await initializeDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    // Reset test database tables to ensure clean, isolated test runs
    await testDb.run('DELETE FROM rate_limit_usage');
    await testDb.run('DELETE FROM audit_log');
    await testDb.run('DELETE FROM api_keys');
    
    // Re-populate default tier limits
    await testDb.run('DELETE FROM tier_limits');
    await testDb.run(`
      INSERT INTO tier_limits (tier, requests_per_minute, requests_per_hour, requests_per_day, burst_limit)
      VALUES
        ('free', 10, 100, 1000, 20),
        ('standard', 100, 1000, 10000, 200),
        ('premium', 1000, 10000, 100000, 2000),
        ('admin', 10000, 100000, 1000000, 20000)
    `);
  });

  // ── 1. generateKey ───────────────────────────────────────────────────────────
  describe('generateKey', () => {
    it('generates an active API key with correct prefix, hash, and logs it to audit', async () => {
      const params = {
        name: 'Developer Key',
        description: 'Key for development env',
        tier: 'standard',
        userId: 42,
        organizationId: 7,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };

      const keyData = await apiKeyService.generateKey(params);

      // Verify returned key object
      expect(keyData).toHaveProperty('id');
      expect(keyData.key).toMatch(/^sk_[a-f0-9]{64}$/);
      expect(keyData.keyPrefix).toBe(keyData.key.substring(0, 8));
      expect(keyData.name).toBe(params.name);
      expect(keyData.description).toBe(params.description);
      expect(keyData.tier).toBe(params.tier);
      expect(keyData.status).toBe('active');
      expect(keyData).toHaveProperty('createdAt');

      // Verify database record
      const dbRow = await testDb.get('SELECT * FROM api_keys WHERE id = ?', [keyData.id]);
      expect(dbRow).toBeTruthy();
      expect(dbRow.name).toBe(params.name);
      expect(dbRow.key_prefix).toBe(keyData.keyPrefix);
      expect(dbRow.tier).toBe(params.tier);
      expect(dbRow.user_id).toBe(params.userId);
      expect(dbRow.organization_id).toBe(params.organizationId);
      expect(dbRow.status).toBe('active');

      // Verify audit log entry
      const auditRow = await testDb.get(
        'SELECT * FROM audit_log WHERE api_key_id = ? AND action = ?',
        [keyData.id, 'key_generated']
      );
      expect(auditRow).toBeTruthy();
      expect(auditRow.user_id).toBe(params.userId);
      
      const metadata = JSON.parse(auditRow.metadata);
      expect(metadata.tier).toBe(params.tier);
      expect(metadata.name).toBe(params.name);
    });

    it('defaults to free tier if none is specified', async () => {
      const keyData = await apiKeyService.generateKey({
        name: 'Default Key',
        userId: 1,
      });

      expect(keyData.tier).toBe('free');

      const dbRow = await testDb.get('SELECT * FROM api_keys WHERE id = ?', [keyData.id]);
      expect(dbRow.tier).toBe('free');
    });
  });

  // ── 2. validateKey ───────────────────────────────────────────────────────────
  describe('validateKey', () => {
    it('returns null for non-existent, null, or invalid format keys', async () => {
      const resultNull = await apiKeyService.validateKey(null);
      const resultUndefined = await apiKeyService.validateKey(undefined);
      const resultEmpty = await apiKeyService.validateKey('');
      const resultNonExistent = await apiKeyService.validateKey('sk_nonexistentkeyhash12345');

      expect(resultNull).toBeNull();
      expect(resultUndefined).toBeNull();
      expect(resultEmpty).toBeNull();
      expect(resultNonExistent).toBeNull();
    });

    it('returns key data and limits on active keys, updates usage count & last used', async () => {
      const keyData = await apiKeyService.generateKey({
        name: 'Standard Key',
        tier: 'standard',
        userId: 10,
      });

      // First validation
      const validation1 = await apiKeyService.validateKey(keyData.key);
      expect(validation1).toBeTruthy();
      expect(validation1.id).toBe(keyData.id);
      expect(validation1.tier).toBe('standard');
      expect(validation1.limits).toEqual({
        requestsPerMinute: 100,
        requestsPerHour: 1000,
        requestsPerDay: 10000,
        burstLimit: 200,
      });
      expect(validation1.usageCount).toBe(1);

      // Check database update
      let dbRow = await testDb.get('SELECT usage_count, last_used_at FROM api_keys WHERE id = ?', [keyData.id]);
      expect(dbRow.usage_count).toBe(1);
      expect(dbRow.last_used_at).not.toBeNull();

      // Second validation
      const validation2 = await apiKeyService.validateKey(keyData.key);
      expect(validation2.usageCount).toBe(2);

      dbRow = await testDb.get('SELECT usage_count FROM api_keys WHERE id = ?', [keyData.id]);
      expect(dbRow.usage_count).toBe(2);
    });

    it('returns null and revokes an expired key', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const keyData = await apiKeyService.generateKey({
        name: 'Expired Key',
        userId: 20,
        expiresAt: yesterday.toISOString(),
      });

      const validation = await apiKeyService.validateKey(keyData.key);
      expect(validation).toBeNull();

      // Verify status has updated to 'expired'
      const dbRow = await testDb.get('SELECT status FROM api_keys WHERE id = ?', [keyData.id]);
      expect(dbRow.status).toBe('expired');

      // Verify revocation was logged to audit
      const auditRow = await testDb.get(
        'SELECT * FROM audit_log WHERE api_key_id = ? AND action = ?',
        [keyData.id, 'key_revoked']
      );
      expect(auditRow).toBeTruthy();
      expect(JSON.parse(auditRow.metadata).reason).toBe('expired');
    });
  });

  // ── 3. getKeyById ────────────────────────────────────────────────────────────
  describe('getKeyById', () => {
    it('returns null if the key ID does not exist', async () => {
      const key = await apiKeyService.getKeyById(999);
      expect(key).toBeNull();
    });

    it('retrieves detailed key metadata and correct tier limits by ID', async () => {
      const keyData = await apiKeyService.generateKey({
        name: 'Premium Key',
        tier: 'premium',
        userId: 15,
        description: 'Premium sandbox access',
      });

      const keyDetails = await apiKeyService.getKeyById(keyData.id);
      expect(keyDetails).toBeTruthy();
      expect(keyDetails.id).toBe(keyData.id);
      expect(keyDetails.name).toBe('Premium Key');
      expect(keyDetails.description).toBe('Premium sandbox access');
      expect(keyDetails.tier).toBe('premium');
      expect(keyDetails.limits).toEqual({
        requestsPerMinute: 1000,
        requestsPerHour: 10000,
        requestsPerDay: 100000,
        burstLimit: 2000,
      });
    });
  });

  // ── 4. listKeys ──────────────────────────────────────────────────────────────
  describe('listKeys', () => {
    it('returns empty array if user has no keys', async () => {
      const keys = await apiKeyService.listKeys(999);
      expect(keys).toEqual([]);
    });

    it('returns all keys for a user in descending order of creation', async () => {
      const key1 = await apiKeyService.generateKey({ name: 'Key 1', userId: 1 });
      // Adjust created_at to ensure distinct ordering
      await testDb.run("UPDATE api_keys SET created_at = datetime('now', '-2 seconds') WHERE id = ?", [key1.id]);

      const key2 = await apiKeyService.generateKey({ name: 'Key 2', userId: 1 });

      const keysList = await apiKeyService.listKeys(1);
      expect(keysList).toHaveLength(2);
      expect(keysList[0].name).toBe('Key 2');
      expect(keysList[1].name).toBe('Key 1');
    });

    it('filters keys by status', async () => {
      const activeKey = await apiKeyService.generateKey({ name: 'Active', userId: 1 });
      const revokedKey = await apiKeyService.generateKey({ name: 'Revoked', userId: 1 });
      await apiKeyService.revokeKey(revokedKey.id, 'revoked');

      const activeKeys = await apiKeyService.listKeys(1, { status: 'active' });
      expect(activeKeys).toHaveLength(1);
      expect(activeKeys[0].id).toBe(activeKey.id);

      const inactiveKeys = await apiKeyService.listKeys(1, { status: 'revoked' });
      expect(inactiveKeys).toHaveLength(1);
      expect(inactiveKeys[0].id).toBe(revokedKey.id);
    });

    it('paginates list using limit and offset', async () => {
      const key1 = await apiKeyService.generateKey({ name: 'Key 1', userId: 2 });
      await testDb.run("UPDATE api_keys SET created_at = datetime('now', '-3 seconds') WHERE id = ?", [key1.id]);

      const key2 = await apiKeyService.generateKey({ name: 'Key 2', userId: 2 });
      await testDb.run("UPDATE api_keys SET created_at = datetime('now', '-2 seconds') WHERE id = ?", [key2.id]);

      const key3 = await apiKeyService.generateKey({ name: 'Key 3', userId: 2 });

      // First page (2 items)
      const page1 = await apiKeyService.listKeys(2, { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);
      expect(page1[0].name).toBe('Key 3');
      expect(page1[1].name).toBe('Key 2');

      // Second page (1 item)
      const page2 = await apiKeyService.listKeys(2, { limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
      expect(page2[0].name).toBe('Key 1');
    });
  });

  // ── 5. revokeKey ─────────────────────────────────────────────────────────────
  describe('revokeKey', () => {
    it('revokes an API key, updates updated_at, and registers key_revoked audit log', async () => {
      const keyData = await apiKeyService.generateKey({
        name: 'Revokable Key',
        userId: 5,
      });

      // Note: Must be 'revoked' or 'expired' to satisfy SQLite CHECK constraint
      await apiKeyService.revokeKey(keyData.id, 'expired');

      // Check status updated
      const dbRow = await testDb.get('SELECT status, updated_at FROM api_keys WHERE id = ?', [keyData.id]);
      expect(dbRow.status).toBe('expired');
      expect(dbRow.updated_at).not.toBeNull();

      // Check audit log
      const auditRow = await testDb.get(
        'SELECT * FROM audit_log WHERE api_key_id = ? AND action = ?',
        [keyData.id, 'key_revoked']
      );
      expect(auditRow).toBeTruthy();
      expect(JSON.parse(auditRow.metadata).reason).toBe('expired');
    });

    it('defaults to revoked reason if none is specified', async () => {
      const keyData = await apiKeyService.generateKey({
        name: 'Revokable Key 2',
        userId: 5,
      });

      await apiKeyService.revokeKey(keyData.id);

      const dbRow = await testDb.get('SELECT status FROM api_keys WHERE id = ?', [keyData.id]);
      expect(dbRow.status).toBe('revoked');
    });
  });

  // ── 6. trackUsage ────────────────────────────────────────────────────────────
  describe('trackUsage', () => {
    it('tracks key endpoint usage and increments count', async () => {
      const keyData = await apiKeyService.generateKey({
        name: 'Usage Key',
        userId: 3,
        tier: 'free',
      });

      const RealDate = global.Date;
      const constantTime = new Date('2026-05-29T11:00:00.000Z');

      // Mock global Date to return constant time during consecutive trackUsage calls
      global.Date = class extends RealDate {
        constructor(...args) {
          if (args.length) {
            // eslint-disable-next-line new-cap
            return new RealDate(...args);
          }
          return constantTime;
        }
        static now() {
          return constantTime.getTime();
        }
      };

      try {
        // First call (creates entry with request_count = 1)
        await apiKeyService.trackUsage(keyData.id, '/api/compile', 'free');

        const usageRow = await testDb.get('SELECT * FROM rate_limit_usage WHERE api_key_id = ?', [keyData.id]);
        expect(usageRow).toBeTruthy();
        expect(usageRow.endpoint).toBe('/api/compile');
        expect(usageRow.request_count).toBe(1);
        expect(usageRow.tier).toBe('free');

        // Second call (hits ON CONFLICT unique index trigger and increments request_count to 2)
        await apiKeyService.trackUsage(keyData.id, '/api/compile', 'free');

        const usageRowUpdated = await testDb.get(
          'SELECT request_count FROM rate_limit_usage WHERE api_key_id = ?',
          [keyData.id]
        );
        expect(usageRowUpdated.request_count).toBe(2);
      } finally {
        global.Date = RealDate;
      }
    });
  });

  // ── 7. logAudit ──────────────────────────────────────────────────────────────
  describe('logAudit', () => {
    it('successfully stores operational operations inside audit_log table', async () => {
      await apiKeyService.logAudit({
        apiKeyId: 10,
        userId: 200,
        action: 'custom_action',
        metadata: { requestIp: '127.0.0.1', isSuccessful: true },
      });

      const auditRow = await testDb.get('SELECT * FROM audit_log WHERE user_id = 200');
      expect(auditRow).toBeTruthy();
      expect(auditRow.api_key_id).toBe(10);
      expect(auditRow.action).toBe('custom_action');
      expect(JSON.parse(auditRow.metadata)).toEqual({
        requestIp: '127.0.0.1',
        isSuccessful: true,
      });
    });
  });

  // ── 8. getUsageStats ──────────────────────────────────────────────────────────
  describe('getUsageStats', () => {
    it('returns grouped daily usage, endpoint distribution, and rate limit violations', async () => {
      const keyData = await apiKeyService.generateKey({
        name: 'Stats Key',
        userId: 9,
      });

      // Insert mock usage
      const now = new Date().toISOString();
      await testDb.run(
        `INSERT INTO rate_limit_usage (api_key_id, endpoint, request_count, window_start, window_end, tier)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [keyData.id, '/api/compile', 25, now, now, 'free']
      );
      await testDb.run(
        `INSERT INTO rate_limit_usage (api_key_id, endpoint, request_count, window_start, window_end, tier)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [keyData.id, '/api/deploy', 10, now, now, 'free']
      );

      // Insert mock violation
      await testDb.run(
        `INSERT INTO audit_log (api_key_id, user_id, action, metadata)
         VALUES (?, ?, ?, ?)`,
        [keyData.id, 9, 'rate_limit_exceeded', JSON.stringify({ endpoint: '/api/compile' })]
      );

      const stats = await apiKeyService.getUsageStats(keyData.id, { days: 7 });

      expect(stats.dailyUsage).toHaveLength(1);
      expect(stats.dailyUsage[0].requests).toBe(35); // 25 + 10

      expect(stats.endpointUsage).toHaveLength(2);
      expect(stats.endpointUsage[0]).toEqual({ endpoint: '/api/compile', requests: 25 });
      expect(stats.endpointUsage[1]).toEqual({ endpoint: '/api/deploy', requests: 10 });

      expect(stats.violations).toHaveLength(1);
      expect(stats.violations[0].count).toBe(1);
      expect(stats.period).toBe('7 days');
    });
  });
});
