import knexLib from 'knex';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  runKnexStartupMigrations,
  verifyKnexSchemaIntegrity,
} from '../src/services/migrationService.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);
const ALL_MIGRATIONS_DIR = path.resolve(_dirname, '../src/database/migrations');

function createTempMigrationsDir() {
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'knex-startup-test-')
  );
  const files = fs
    .readdirSync(ALL_MIGRATIONS_DIR)
    .filter((f) => f.startsWith('20260701') && f.endsWith('.js'));

  for (const file of files) {
    fs.copyFileSync(
      path.join(ALL_MIGRATIONS_DIR, file),
      path.join(tmpDir, file)
    );
  }

  return { tmpDir, files };
}

function createTestKnex(migrationsDir) {
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

describe('Knex Startup Migrations & Schema Verification', () => {
  let knex;
  let tmpDir;

  beforeEach(() => {
    const res = createTempMigrationsDir();
    tmpDir = res.tmpDir;
    knex = createTestKnex(tmpDir);
  });

  afterEach(async () => {
    await knex.destroy();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runs automated Knex startup migrations and passes schema integrity check', async () => {
    const result = await runKnexStartupMigrations(knex);
    expect(result.success).toBe(true);
    expect(result.batchNo).toBe(1);
    expect(result.integrity.valid).toBe(true);
    expect(result.integrity.tablesChecked).toBe(14);
  });

  it('throws an error if schema integrity verification finds missing tables', async () => {
    // Empty database without running migrations
    await expect(verifyKnexSchemaIntegrity(knex)).rejects.toThrow(
      /Schema integrity check failed/
    );
  });
});
