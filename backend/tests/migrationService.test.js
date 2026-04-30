import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { getDatabase, closeDatabase } from '../src/services/dbService.js';
import {
  initializeMigrationService,
  getMigrationDashboard,
  applyPendingMigrations,
  applyMigration,
  rollbackMigration,
  validateMigrations,
  getAppliedMigrations,
} from '../src/services/migrationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const createTempEnvironment = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
  const migrationsDir = path.join(root, 'migrations');
  const dbPath = path.join(root, 'test.db');
  process.env.MIGRATIONS_DIR = migrationsDir;
  process.env.MIGRATION_DB_PATH = dbPath;
  await fs.mkdir(migrationsDir, { recursive: true });
  return { root, migrationsDir, dbPath };
};

const writeMigrationPair = async (migrationsDir, version, name, upSql, downSql) => {
  const upFile = path.join(migrationsDir, `V${String(version).padStart(3, '0')}__${name}.up.sql`);
  const downFile = path.join(migrationsDir, `V${String(version).padStart(3, '0')}__${name}.down.sql`);
  await fs.writeFile(upFile, upSql, 'utf8');
  await fs.writeFile(downFile, downSql, 'utf8');
};

describe('Migration Service', () => {
  let temp;

  beforeEach(async () => {
    temp = await createTempEnvironment();
  });

  afterEach(async () => {
    await closeDatabase();
    if (temp?.root) {
      await fs.rm(temp.root, { recursive: true, force: true });
    }
  });

  it('validates migration pairs and reports no issues', async () => {
    await writeMigrationPair(
      temp.migrationsDir,
      1,
      'create_users',
      'CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);',
      'DROP TABLE IF EXISTS users;'
    );

    const issues = await validateMigrations();
    expect(issues).toEqual(expect.arrayContaining([]));
  });

  it('applies and rolls back a migration using the dashboard', async () => {
    await writeMigrationPair(
      temp.migrationsDir,
      1,
      'create_users',
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE);',
      'DROP TABLE IF EXISTS users;'
    );

    await initializeMigrationService();
    const applyResults = await applyPendingMigrations({ dryRun: false });
    expect(applyResults).toHaveLength(1);
    expect(applyResults[0].status).toBe('applied');

    const db = await getDatabase();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users';").get();
    expect(row).toBeTruthy();

    const rollbackResult = await rollbackMigration(1, { dryRun: false });
    expect(rollbackResult.status).toBe('rolled_back');

    const afterRow = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users';").get();
    expect(afterRow).toBeUndefined();
  });

  it('does not persist changes during dry-run', async () => {
    await writeMigrationPair(
      temp.migrationsDir,
      1,
      'create_users',
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE);',
      'DROP TABLE IF EXISTS users;'
    );

    await initializeMigrationService();
    const result = await applyMigration(1, { dryRun: true });
    expect(result.status).toBe('dry_run_success');

    const db = await getDatabase();
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users';").get();
    expect(row).toBeUndefined();

    const applied = await getAppliedMigrations();
    expect(applied).toHaveLength(0);
  });

  it('rejects modified migration SQL after apply via checksum mismatch', async () => {
    await writeMigrationPair(
      temp.migrationsDir,
      1,
      'create_users',
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE);',
      'DROP TABLE IF EXISTS users;'
    );

    await initializeMigrationService();
    const firstApply = await applyPendingMigrations({ dryRun: false });
    expect(firstApply[0].status).toBe('applied');

    await fs.writeFile(
      path.join(temp.migrationsDir, 'V001__create_users.up.sql'),
      'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT);',
      'utf8'
    );

    await expect(applyMigration(1, { dryRun: false })).rejects.toThrow(/Checksum mismatch/);
  });
});
