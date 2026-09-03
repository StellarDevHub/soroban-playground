/**
 * backend/tests/knexMigrations.test.js
 *
 * Integration test: Knex migration schema parity (V001–V007)
 *
 * Verifies that all Knex migration files in src/database/migrations/ whose
 * names start with "2026070100" (the new V001–V007 batch) can be:
 *   1. Applied cleanly to a fresh in-memory SQLite database.
 *   2. Fully rolled back without error.
 *   3. Re-applied after rollback (clean-slate idempotency).
 *
 * The test intentionally excludes the legacy 20260630000000_initial_schema.js
 * migration because that file uses a raw sqlite3 driver API incompatible with
 * the Jest/Babel ESM transform environment, and is tracked separately as a
 * pre-existing migration outside this PR's scope.
 *
 * No external services are required — everything runs on SQLite in-memory.
 */

import knexLib from 'knex';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

// Resolve the directory that holds the new Knex migration files.
const ALL_MIGRATIONS_DIR = path.resolve(_dirname, '../src/database/migrations');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a temporary directory that symlinks only the migrations whose names
 * start with the given prefix.  This lets us run a subset of migrations
 * without modifying the real migrations folder.
 *
 * Returns the path to the temp directory (caller must clean up).
 */
async function createSubsetMigrationsDir(prefix) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knex-test-migrations-'));
  const files = fs.readdirSync(ALL_MIGRATIONS_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.js'));

  for (const file of files) {
    // Copy (not symlink) so that Knex can load them via require() during tests
    fs.copyFileSync(
      path.join(ALL_MIGRATIONS_DIR, file),
      path.join(tmpDir, file)
    );
  }

  return { tmpDir, files };
}

/**
 * Create a fresh Knex instance pointing to an in-memory SQLite database
 * and the given migrations directory.
 */
function createKnex(migrationsDir) {
  return knexLib({
    client: 'sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: {
      directory: migrationsDir,
      loadExtensions: ['.js'],
    },
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Prefix shared by all new V001–V007 migration files
const MIGRATION_PREFIX = '20260701';

// Tables that must exist after running all V001–V007 migrations
const EXPECTED_TABLES = [
  'users',
  'organizations',
  'api_keys',
  'rate_limit_usage',
  'tier_limits',
  'audit_log',
  'synthetic_assets',
  'positions',
  'asset_prices',
  'synthetic_asset_events',
  'liquidation_alerts',
  'protocol_params_history',
  'collateral_ratio_history',
  'user_position_summary',
  'cors_whitelist',
  'webhook_subscriptions',
  'webhook_deliveries',
  'contract_events',
  'contract_event_cursor',
  'contract_verification',
];

// Key columns per table to spot-check schema parity
const COLUMN_CHECKS = [
  { table: 'users',                  column: 'username' },
  { table: 'users',                  column: 'email' },
  { table: 'users',                  column: 'password_hash' },
  { table: 'api_keys',               column: 'key_hash' },
  { table: 'api_keys',               column: 'tier' },
  { table: 'api_keys',               column: 'status' },
  { table: 'rate_limit_usage',       column: 'window_start' },
  { table: 'rate_limit_usage',       column: 'window_end' },
  { table: 'tier_limits',            column: 'requests_per_minute' },
  { table: 'audit_log',              column: 'action' },
  { table: 'audit_log',              column: 'ip_address' },
  { table: 'synthetic_assets',       column: 'symbol' },
  { table: 'synthetic_assets',       column: 'decimals' },
  { table: 'positions',              column: 'position_id' },
  { table: 'positions',              column: 'user_address' },
  { table: 'positions',              column: 'asset_symbol' },
  { table: 'positions',              column: 'direction' },
  { table: 'asset_prices',           column: 'price' },
  { table: 'asset_prices',           column: 'confidence' },
  { table: 'synthetic_asset_events', column: 'event_type' },
  { table: 'synthetic_asset_events', column: 'details' },
  { table: 'liquidation_alerts',     column: 'alerted_at' },
  { table: 'cors_whitelist',         column: 'origin' },
  { table: 'cors_whitelist',         column: 'active' },
  { table: 'webhook_subscriptions',  column: 'url' },
  { table: 'webhook_subscriptions',  column: 'secret' },
  { table: 'webhook_deliveries',     column: 'subscription_id' },
  { table: 'webhook_deliveries',     column: 'status' },
  { table: 'contract_events',        column: 'contract_id' },
  { table: 'contract_events',        column: 'ledger_sequence' },
  { table: 'contract_event_cursor',  column: 'cursor' },
  { table: 'contract_verification',  column: 'source_hash' },
  { table: 'contract_verification',  column: 'status' },
];

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Knex migrations — schema parity (SQLite in-memory)', () => {
  let knex;
  let tmpDir;
  let migrationFiles;

  beforeAll(async () => {
    const result = await createSubsetMigrationsDir(MIGRATION_PREFIX);
    tmpDir = result.tmpDir;
    migrationFiles = result.files;
  });

  afterAll(() => {
    // Clean up the temporary directory
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    knex = createKnex(tmpDir);
  });

  afterEach(async () => {
    await knex.destroy();
  });

  // ── 0. Sanity: migration files were found ────────────────────────────────

  it('discovers the expected number of V001-V007 migration files', () => {
    expect(migrationFiles.length).toBe(8); // V001 through V007 + V004b = 8 files
  });

  // ── 1. migrate:latest runs without errors ────────────────────────────────

  it('applies all migrations without throwing', async () => {
    await expect(knex.migrate.latest()).resolves.toBeDefined();
  });

  // ── 2. knex_migrations table is populated ────────────────────────────────

  it('records all applied migrations in knex_migrations', async () => {
    await knex.migrate.latest();

    const rows = await knex('knex_migrations').select('name').orderBy('id');
    expect(rows.length).toBe(8);

    rows.forEach(({ name }) => {
      expect(name).toMatch(/^20260701/);
    });
  });

  // ── 3. Expected tables exist ─────────────────────────────────────────────

  it.each(EXPECTED_TABLES)(
    'table "%s" exists after migrate:latest',
    async (tableName) => {
      await knex.migrate.latest();
      const exists = await knex.schema.hasTable(tableName);
      expect(exists).toBe(true);
    }
  );

  // ── 4. Key columns exist ─────────────────────────────────────────────────

  it.each(COLUMN_CHECKS)(
    'column $table.$column exists',
    async ({ table, column }) => {
      await knex.migrate.latest();
      const exists = await knex.schema.hasColumn(table, column);
      expect(exists).toBe(true);
    }
  );

  // ── 5. Seed data was inserted by V002 ────────────────────────────────────

  it('tier_limits contains the four default tiers after migration', async () => {
    await knex.migrate.latest();

    const rows = await knex('tier_limits').select('tier').orderBy('tier');
    const tiers = rows.map((r) => r.tier).sort();
    expect(tiers).toEqual(['admin', 'free', 'premium', 'standard']);
  });

  // ── 6. Full rollback succeeds ────────────────────────────────────────────

  it('rolls back all migrations without throwing', async () => {
    await knex.migrate.latest();
    await expect(knex.migrate.rollback({}, true)).resolves.toBeDefined();
  });

  // ── 7. Tables are removed after rollback ─────────────────────────────────

  it('tables created by V001–V007 are gone after full rollback', async () => {
    await knex.migrate.latest();
    await knex.migrate.rollback({}, true);

    const tablesToCheck = [
      'users', 'organizations', 'api_keys', 'rate_limit_usage',
      'tier_limits', 'audit_log', 'synthetic_assets', 'positions',
      'cors_whitelist', 'webhook_subscriptions', 'webhook_deliveries',
      'contract_events', 'contract_event_cursor', 'contract_verification',
    ];

    for (const t of tablesToCheck) {
      const exists = await knex.schema.hasTable(t);
      expect(exists).toBe(false);
    }
  });

  // ── 8. Re-apply after rollback (clean-slate idempotency) ─────────────────

  it('can re-apply all migrations after a full rollback', async () => {
    await knex.migrate.latest();
    await knex.migrate.rollback({}, true);
    await expect(knex.migrate.latest()).resolves.toBeDefined();

    for (const t of ['users', 'api_keys', 'contract_events', 'contract_verification']) {
      const exists = await knex.schema.hasTable(t);
      expect(exists).toBe(true);
    }
  });

  // ── 9. CRUD round-trips through the migrated schema ──────────────────────

  it('can insert and select a users row', async () => {
    await knex.migrate.latest();

    await knex('users').insert({
      username: 'alice',
      email: 'alice@example.com',
      password_hash: 'hashed_pw',
    });

    const [user] = await knex('users').where({ username: 'alice' });
    expect(user).toBeDefined();
    expect(user.email).toBe('alice@example.com');
  });

  it('can insert an api_key linked to a user', async () => {
    await knex.migrate.latest();

    const [insertedId] = await knex('users')
      .insert({
        username: 'bob',
        email: 'bob@example.com',
        password_hash: 'hashed_pw',
      });

    await knex('api_keys').insert({
      key_hash: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      key_prefix: 'abc123de',
      name: 'Test Key',
      tier: 'free',
      status: 'active',
      user_id: insertedId,
    });

    const [key] = await knex('api_keys').where({ key_prefix: 'abc123de' });
    expect(key).toBeDefined();
    expect(key.tier).toBe('free');
    expect(key.status).toBe('active');
  });

  it('can insert a contract_events row', async () => {
    await knex.migrate.latest();

    await knex('contract_events').insert({
      contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
      ledger_sequence: 12345,
      topics: JSON.stringify(['transfer', 'alice', 'bob']),
      value: '1000',
      event_type: 'contract',
    });

    const [evt] = await knex('contract_events').where({
      contract_id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
    });
    expect(evt).toBeDefined();
    expect(evt.ledger_sequence).toBe(12345);
  });
});
