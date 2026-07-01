import { jest } from '@jest/globals';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TEST_DIR = path.join(os.tmpdir(), `migrations-zdt-${process.pid}`);
const TEST_DB_PATH = path.join(
  os.tmpdir(),
  `migrations-zdt-db-${process.pid}.sqlite`
);

// Set env vars before importing the service (Babel hoisting means imports run first,
// but getMigrationsDir() reads env at call-time, so this still applies at runtime).
process.env.MIGRATIONS_DIR = TEST_DIR;
process.env.MIGRATION_DB_PATH = TEST_DB_PATH;

import {
  detectPhase,
  detectLockingSQL,
  applyPendingMigrationsPhased,
  runStartupMigrations,
  initializeMigrationService,
  getAppliedMigrations,
} from '../src/services/migrationService.js';
import { closeDatabase } from '../src/services/dbService.js';

function writeMigration(name, direction, content) {
  fs.writeFileSync(path.join(TEST_DIR, `${name}.${direction}.sql`), content);
}

beforeAll(() => {
  fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await closeDatabase();
  delete process.env.MIGRATIONS_DIR;
  delete process.env.MIGRATION_DB_PATH;
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
});

beforeEach(async () => {
  // Close the current DB (sets db=null) then delete the file so the next
  // getDatabase() call starts with a completely empty in-memory database.
  await closeDatabase();
  try {
    fs.unlinkSync(TEST_DB_PATH);
  } catch {}
  // Clear all migration files between tests
  for (const f of fs.readdirSync(TEST_DIR)) {
    fs.unlinkSync(path.join(TEST_DIR, f));
  }
  // Re-initialise migration table on a fresh empty DB
  await initializeMigrationService();
});

// ──────────────────────────────────────────────────────────────────────────────
// detectPhase
// ──────────────────────────────────────────────────────────────────────────────

describe('detectPhase()', () => {
  it('returns "expand" for -- @phase: expand comment', () => {
    expect(
      detectPhase('-- @phase: expand\nCREATE TABLE foo (id INTEGER);')
    ).toBe('expand');
  });

  it('returns "contract" for -- @phase: contract comment', () => {
    expect(detectPhase('-- @phase: contract\nDROP COLUMN bar;')).toBe(
      'contract'
    );
  });

  it('returns null when no phase comment is present', () => {
    expect(detectPhase('CREATE TABLE foo (id INTEGER);')).toBeNull();
  });

  it('is case-insensitive to extra spaces around the tag', () => {
    expect(detectPhase('--  @phase:  expand')).toBe('expand');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// detectLockingSQL
// ──────────────────────────────────────────────────────────────────────────────

describe('detectLockingSQL()', () => {
  it('warns on ALTER TABLE ADD COLUMN NOT NULL without DEFAULT', () => {
    const sql = 'ALTER TABLE users ADD COLUMN name TEXT NOT NULL;';
    const warns = detectLockingSQL(sql);
    expect(warns.length).toBe(1);
    expect(warns[0]).toMatch(/NOT NULL without DEFAULT/);
  });

  it('does NOT warn on ALTER TABLE ADD COLUMN with DEFAULT', () => {
    const sql = 'ALTER TABLE users ADD COLUMN name TEXT DEFAULT NULL;';
    expect(detectLockingSQL(sql)).toHaveLength(0);
  });

  it('does NOT warn on CREATE TABLE or INSERT statements', () => {
    const sql = 'CREATE TABLE foo (id INTEGER NOT NULL);';
    expect(detectLockingSQL(sql)).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// applyPendingMigrationsPhased
// ──────────────────────────────────────────────────────────────────────────────

describe('applyPendingMigrationsPhased()', () => {
  it('applies only expand-tagged migrations when phase="expand"', async () => {
    writeMigration(
      'V001__expand_add_col',
      'up',
      '-- @phase: expand\nSELECT 1;'
    );
    writeMigration('V001__expand_add_col', 'down', 'SELECT 1;');
    writeMigration(
      'V002__contract_drop',
      'up',
      '-- @phase: contract\nSELECT 2;'
    );
    writeMigration('V002__contract_drop', 'down', 'SELECT 1;');
    writeMigration('V003__no_phase', 'up', 'SELECT 3;');
    writeMigration('V003__no_phase', 'down', 'SELECT 1;');

    const results = await applyPendingMigrationsPhased('expand');
    const versions = results.map((r) => r.version);

    expect(versions).toContain(1);
    expect(versions).not.toContain(2);
    expect(versions).not.toContain(3);
  });

  it('skips expand-tagged migrations when phase="contract"', async () => {
    writeMigration('V001__expand_add', 'up', '-- @phase: expand\nSELECT 1;');
    writeMigration('V001__expand_add', 'down', 'SELECT 1;');
    writeMigration('V002__contract_rm', 'up', '-- @phase: contract\nSELECT 2;');
    writeMigration('V002__contract_rm', 'down', 'SELECT 1;');

    const results = await applyPendingMigrationsPhased('contract');
    const versions = results.map((r) => r.version);

    expect(versions).not.toContain(1);
    expect(versions).toContain(2);
  });

  it('applies all pending when phase=null (backward compat)', async () => {
    writeMigration('V001__a', 'up', '-- @phase: expand\nSELECT 1;');
    writeMigration('V001__a', 'down', 'SELECT 1;');
    writeMigration('V002__b', 'up', 'SELECT 2;');
    writeMigration('V002__b', 'down', 'SELECT 1;');

    const results = await applyPendingMigrationsPhased(null);
    const versions = results.map((r) => r.version);

    expect(versions).toContain(1);
    expect(versions).toContain(2);
  });

  it('attaches phase and lockWarnings metadata to each result', async () => {
    writeMigration('V001__exp', 'up', '-- @phase: expand\nSELECT 1;');
    writeMigration('V001__exp', 'down', 'SELECT 1;');

    const results = await applyPendingMigrationsPhased('expand');
    expect(results[0]).toHaveProperty('phase', 'expand');
    expect(results[0]).toHaveProperty('lockWarnings');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// runStartupMigrations
// ──────────────────────────────────────────────────────────────────────────────

describe('runStartupMigrations()', () => {
  it('applies pending migrations on first call', async () => {
    writeMigration('V001__init', 'up', 'SELECT 1;');
    writeMigration('V001__init', 'down', 'SELECT 1;');

    const results = await runStartupMigrations();
    expect(results.some((r) => r.status === 'applied')).toBe(true);
  });

  it('is idempotent - second call returns empty results', async () => {
    writeMigration('V001__init', 'up', 'SELECT 1;');
    writeMigration('V001__init', 'down', 'SELECT 1;');

    await runStartupMigrations();
    const second = await runStartupMigrations();
    expect(second).toHaveLength(0);
  });
});
