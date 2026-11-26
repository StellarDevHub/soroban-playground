import knexLib from 'knex';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const MIGRATIONS_DIR = path.resolve(_dirname, '../src/database/migrations');
const MIGRATION_FILES = [
  '20260701000001_create_users_table.js',
  '20260701000002_add_rate_limiting.js',
  '20260701000007_multi_tenant_isolation.js',
  '20261126000014_api_key_scopes_rotation.js',
];

describe('API key scopes and rotation migration', () => {
  let knex;
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-migrations-'));
    for (const file of MIGRATION_FILES) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(tmpDir, file));
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
      migrations: { directory: tmpDir, loadExtensions: ['.js'] },
    });
  });

  afterEach(async () => {
    await knex.destroy();
  });

  it('backfills legacy keys and adds rotation columns', async () => {
    await knex.migrate.up();
    await knex.migrate.up();
    await knex.migrate.up();

    await knex('api_keys').insert({
      key_hash: 'a'.repeat(64),
      key_prefix: 'sk_legacy',
      name: 'Legacy Key',
      tier: 'free',
    });

    await knex.migrate.latest();

    const columns = await knex('api_keys').columnInfo();
    expect(columns).toHaveProperty('scopes');
    expect(columns).toHaveProperty('rotation_group_id');
    expect(columns).toHaveProperty('rotation_role');
    expect(columns).toHaveProperty('replaces_key_id');
    expect(columns).toHaveProperty('rotation_cutoff_at');

    const row = await knex('api_keys').first();
    expect(JSON.parse(row.scopes)).toEqual([
      'contracts:read',
      'contracts:compile',
      'contracts:deploy',
    ]);
    expect(row.rotation_role).toBe('standalone');

    const indexes = await knex.raw("PRAGMA index_list('api_keys')");
    expect(indexes.map((index) => index.name)).toContain(
      'idx_api_keys_rotation_group'
    );
  });
});
