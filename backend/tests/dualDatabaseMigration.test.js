/**
 * backend/tests/dualDatabaseMigration.test.js
 *
 * Dual-database migration test suite (BACKEND-240).
 *
 * 1. Verifies dialect-agnostic datatype mapping (DATETIME -> TIMESTAMPTZ,
 *    BLOB -> BYTEA) and SQL sanitization in migrationService.js.
 * 2. Runs the standardized Knex migrations (including 20260630000000_initial_schema.js)
 *    against SQLite in-memory.
 * 3. When DATABASE_CLIENT=pg and DATABASE_URL are set (e.g. in CI), runs the
 *    exact same migration lifecycle against PostgreSQL and verifies TIMESTAMPTZ
 *    and BYTEA column types in information_schema.columns.
 */

import knexLib from 'knex';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  SQLITE_TO_PG_TYPE_MAP,
  sanitizeIdentifier,
  sanitizeQueryString,
  formatPlaceholdersForDialect,
  mapSqliteTypeToPostgres,
  translateSQLForDialect,
} from '../src/services/migrationService.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);
const ALL_MIGRATIONS_DIR = path.resolve(_dirname, '../src/database/migrations');

function createMigrationsSubsetDir() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-db-migrations-'));
  const files = fs
    .readdirSync(ALL_MIGRATIONS_DIR)
    .filter(
      (f) =>
        (f.startsWith('20260630') || f.startsWith('20260701')) &&
        f.endsWith('.js')
    );

  for (const file of files) {
    fs.copyFileSync(
      path.join(ALL_MIGRATIONS_DIR, file),
      path.join(tmpDir, file)
    );
  }
  return { tmpDir, files };
}

describe('migrationService dialect mapping & sanitization (BACKEND-240)', () => {
  it('maps SQLite DATETIME and BLOB to PostgreSQL TIMESTAMPTZ and BYTEA', () => {
    expect(SQLITE_TO_PG_TYPE_MAP.DATETIME).toBe('TIMESTAMPTZ');
    expect(SQLITE_TO_PG_TYPE_MAP.BLOB).toBe('BYTEA');
    expect(mapSqliteTypeToPostgres('DATETIME')).toBe('TIMESTAMPTZ');
    expect(mapSqliteTypeToPostgres('datetime')).toBe('TIMESTAMPTZ');
    expect(mapSqliteTypeToPostgres('BLOB')).toBe('BYTEA');
    expect(mapSqliteTypeToPostgres('blob')).toBe('BYTEA');
    expect(mapSqliteTypeToPostgres('TEXT')).toBe('TEXT');
  });

  it('translates SQLite DDL to PostgreSQL-compatible SQL', () => {
    const sqliteDDL = `
      CREATE TABLE files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload BLOB,
        created_at DATETIME DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO roles (name) VALUES ('admin');
    `;

    const pgSQL = translateSQLForDialect(sqliteDDL, 'pg');
    expect(pgSQL).toContain('SERIAL PRIMARY KEY');
    expect(pgSQL).toContain('BYTEA');
    expect(pgSQL).toContain('TIMESTAMPTZ');
    expect(pgSQL).toContain('DEFAULT CURRENT_TIMESTAMP');
    expect(pgSQL).toContain('ON CONFLICT DO NOTHING');
    expect(pgSQL).not.toMatch(/\bAUTOINCREMENT\b/i);
    expect(pgSQL).not.toMatch(/\bDATETIME\b/i);
    expect(pgSQL).not.toMatch(/\bBLOB\b/i);
  });

  it('preserves SQLite DDL when dialect is sqlite3', () => {
    const sql =
      'CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB, ts DATETIME);';
    expect(translateSQLForDialect(sql, 'sqlite3')).toBe(sql);
  });

  it('sanitizes SQL identifiers and rejects injection attempts', () => {
    expect(sanitizeIdentifier('_schema_migrations')).toBe('_schema_migrations');
    expect(sanitizeIdentifier('users_v2')).toBe('users_v2');
    expect(() => sanitizeIdentifier('users; DROP TABLE users;--')).toThrow(
      /Invalid SQL identifier/
    );
    expect(() => sanitizeIdentifier('123invalid')).toThrow(
      /Invalid SQL identifier/
    );
    expect(() => sanitizeIdentifier('')).toThrow(/Invalid SQL identifier/);
  });

  it('sanitizes query strings and strips control characters', () => {
    expect(sanitizeQueryString('  SELECT 1;\x00  ')).toBe('SELECT 1;');
    expect(() => sanitizeQueryString('   ')).toThrow(/cannot be empty/);
    expect(() => sanitizeQueryString(null)).toThrow(/must be a string/);
  });

  it('formats positional placeholders for PostgreSQL vs SQLite', () => {
    const query = 'SELECT * FROM users WHERE id = ? AND status = ?';
    expect(formatPlaceholdersForDialect(query, 'sqlite3')).toBe(query);
    expect(formatPlaceholdersForDialect(query, 'pg')).toBe(
      'SELECT * FROM users WHERE id = $1 AND status = $2'
    );
  });
});

describe('Dual-Database Knex Migrations — SQLite', () => {
  let tmpDir;
  let knex;

  beforeAll(() => {
    ({ tmpDir } = createMigrationsSubsetDir());
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

  it('applies initial schema + V001-V007, rolls back, and re-applies cleanly on SQLite', async () => {
    await expect(knex.migrate.latest()).resolves.toBeDefined();

    for (const table of [
      'users',
      'roles',
      'permissions',
      'projects',
      'files',
      'templates',
      'api_keys',
      'tier_limits',
      'webhook_subscriptions',
      'contract_events',
      'contract_verification',
    ]) {
      expect(await knex.schema.hasTable(table)).toBe(true);
    }

    await expect(knex.migrate.rollback({}, true)).resolves.toBeDefined();
    expect(await knex.schema.hasTable('users')).toBe(false);

    await expect(knex.migrate.latest()).resolves.toBeDefined();
    expect(await knex.schema.hasTable('users')).toBe(true);
  });
});

const runPgSuite =
  process.env.DATABASE_CLIENT === 'pg' && Boolean(process.env.DATABASE_URL);

(runPgSuite ? describe : describe.skip)(
  'Dual-Database Knex Migrations — PostgreSQL',
  () => {
    let tmpDir;
    let knex;

    beforeAll(() => {
      ({ tmpDir } = createMigrationsSubsetDir());
      knex = knexLib({
        client: 'pg',
        connection: process.env.DATABASE_URL,
        migrations: {
          directory: tmpDir,
          loadExtensions: ['.js'],
        },
      });
    });

    afterAll(async () => {
      if (knex) {
        await knex.migrate.rollback({}, true).catch(() => {});
        await knex.destroy();
      }
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('applies migrations, verifies TIMESTAMPTZ & BYTEA types, rolls back, and re-applies on PostgreSQL', async () => {
      await knex.migrate.rollback({}, true).catch(() => {});
      await expect(knex.migrate.latest()).resolves.toBeDefined();

      // Verify TIMESTAMPTZ mapping on users.created_at
      const tsCol = await knex('information_schema.columns')
        .select('data_type')
        .where({ table_name: 'users', column_name: 'created_at' })
        .first();
      expect(tsCol?.data_type).toBe('timestamp with time zone');

      // Verify BYTEA mapping on files.content
      const binCol = await knex('information_schema.columns')
        .select('data_type')
        .where({ table_name: 'files', column_name: 'content' })
        .first();
      expect(binCol?.data_type).toBe('bytea');

      // Rollback and re-apply
      await expect(knex.migrate.rollback({}, true)).resolves.toBeDefined();
      expect(await knex.schema.hasTable('users')).toBe(false);

      await expect(knex.migrate.latest()).resolves.toBeDefined();
      expect(await knex.schema.hasTable('users')).toBe(true);
    });
  }
);
