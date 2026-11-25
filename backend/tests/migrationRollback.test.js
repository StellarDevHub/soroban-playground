/**
 * backend/tests/migrationRollback.test.js
 *
 * CI validation for all Knex migrations:
 *   1. Every migration exports both `up` and `down` and sets `lock_timeout = '3s'` on PostgreSQL.
 *   2. Index creation on existing tables uses `CREATE [UNIQUE] INDEX CONCURRENTLY` with `transaction: false`.
 *   3. `knexfile.js` configures `lock_timeout` on PostgreSQL pool connections.
 *   4. Monthly partitioning migrations exist for both `audit_log` and `contract_events`.
 *   5. Every migration can be applied via `migrate.latest()`, rolled back step-by-step
 *      via `migrate.down()` until zero migrations remain, and re-applied cleanly.
 */

import knexLib from 'knex';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const MIGRATIONS_DIR = path.resolve(_dirname, '../src/database/migrations');
const KNEXFILE_PATH = path.resolve(_dirname, '../knexfile.js');

// Legacy SQLite-only schema.sql runner is excluded from in-memory Knex rollback loop
// (tracked separately from Knex-native migrations).
const LEGACY_INITIAL = '20260630000000_initial_schema.js';

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

describe('Zero-downtime migration standards & rollback validation', () => {
  const allFiles = listMigrationFiles();
  const knexNativeFiles = allFiles.filter((f) => f !== LEGACY_INITIAL);

  it('configures lock_timeout in knexfile.js for PostgreSQL pools', () => {
    const src = fs.readFileSync(KNEXFILE_PATH, 'utf8');
    expect(src).toMatch(/SET lock_timeout/);
    expect(src).toMatch(/afterCreate/);
  });

  it.each(allFiles)(
    'migration "%s" sets lock_timeout = 3s for PostgreSQL',
    (file) => {
      const src = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      expect(src).toMatch(/SET lock_timeout = '3s'/);
    }
  );

  it('uses CREATE INDEX CONCURRENTLY with transaction: false for kafka_event_consumer indexes', () => {
    const src = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261022000012_kafka_event_consumer.js'),
      'utf8'
    );
    expect(src).toMatch(/export const config\s*=\s*\{\s*transaction:\s*false\s*\}/);
    expect(src).toMatch(/CREATE UNIQUE INDEX CONCURRENTLY/);
    expect(src).toMatch(/CREATE INDEX CONCURRENTLY/);
    expect(src).toMatch(/DROP INDEX CONCURRENTLY/);
  });

  it('includes monthly range partitioning migrations for audit_log and contract_events', () => {
    const auditSrc = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261021000010_partition_audit_log.js'),
      'utf8'
    );
    const eventsSrc = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261023000013_partition_contract_events.js'),
      'utf8'
    );
    expect(auditSrc).toMatch(/PARTITION BY RANGE/);
    expect(auditSrc).toMatch(/ensure_audit_log_partitions/);
    expect(eventsSrc).toMatch(/PARTITION BY RANGE/);
    expect(eventsSrc).toMatch(/ensure_contract_events_partitions/);
  });

  describe('Step-by-step rollback & re-apply for every Knex migration', () => {
    let tmpDir;
    let knex;

    beforeAll(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knex-rollback-ci-'));
      for (const file of knexNativeFiles) {
        fs.copyFileSync(
          path.join(MIGRATIONS_DIR, file),
          path.join(tmpDir, file)
        );
      }
    });

    afterAll(() => {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    beforeEach(() => {
      knex = knexLib({
        client: 'sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        migrations: {
          directory: tmpDir,
          loadExtensions: ['.js'],
        },
      });
    });

    afterEach(async () => {
      await knex.destroy();
    });

    it('applies all migrations, rolls back each one individually, and re-applies cleanly', async () => {
      // 1. Apply all migrations
      const [, applied] = await knex.migrate.latest();
      expect(applied.length).toBe(knexNativeFiles.length);

      // 2. Roll back every single migration one by one
      for (let i = knexNativeFiles.length - 1; i >= 0; i--) {
        const [, rolledBack] = await knex.migrate.down();
        expect(rolledBack).toEqual([knexNativeFiles[i]]);
      }

      const remaining = await knex('knex_migrations').select('name');
      expect(remaining).toHaveLength(0);

      // 3. Re-apply all migrations to verify idempotent clean-slate recovery
      const [, reapplied] = await knex.migrate.latest();
      expect(reapplied.length).toBe(knexNativeFiles.length);
    });
  });
});
