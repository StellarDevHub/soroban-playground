import fs from 'node:fs';
import path from 'node:path';
import knexLib from 'knex';
import { withTenant } from '../src/database/tenantContext.js';
import { up as applyRls } from '../src/database/migrations/20261021000011_rls_policies.js';

const enabled = process.env.DATABASE_CLIENT === 'pg' && process.env.DATABASE_URL;
const suite = enabled ? describe : describe.skip;

suite('RLS tenant isolation', () => {
  let db;
  const project = (tenant, title) => ({
    tenant_id: tenant, title, description: 'rls test', category: 'test',
    status: 'draft', creator_id: 1, creator_name: 'rls', funding_goal: 1,
  });
  const titles = (ctx) =>
    withTenant(db, ctx, async (trx) =>
      (await trx('projects').where('title', 'like', 'rls-%').select('title')).map((r) => r.title));

  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: process.env.DATABASE_URL });
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/pg-tenant-schema.sql'),
      'utf8',
    );
    await db.raw(schema);
    await applyRls(db);
    await db('projects').insert([project('user:1', 'rls-a'), project('user:2', 'rls-b')]);
  });
  afterAll(async () => {
    await db.destroy();
  });

  test('each user sees only their own rows', async () => {
    expect(await titles({ userId: 1 })).toEqual(['rls-a']);
    expect(await titles({ userId: 2 })).toEqual(['rls-b']);
  });

  test('no tenant context fails closed', async () => {
    expect(await titles({})).toEqual([]);
  });

  test('cannot insert a row for another tenant', async () => {
    await expect(
      withTenant(db, { userId: 1 }, (trx) => trx('projects').insert(project('user:2', 'rls-x'))),
    ).rejects.toThrow(/row-level security/i);
  });

  test('cannot update or delete another tenant row', async () => {
    const updated = await withTenant(db, { userId: 1 }, (trx) =>
      trx('projects').where({ title: 'rls-b' }).update({ description: 'hacked' }));
    const deleted = await withTenant(db, { userId: 1 }, (trx) =>
      trx('projects').where({ title: 'rls-b' }).del());
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
    expect((await db('projects').where({ title: 'rls-b' }).first()).description).toBe('rls test');
  });

  test('injection-style user ids match nothing and break nothing', async () => {
    for (const evil of ["1' OR '1'='1", '1; DROP TABLE projects; --', 'user:2', '%', "' OR tenant_id <> '"]) {
      expect(await titles({ userId: evil })).toEqual([]);
    }
    expect(await db.schema.hasTable('projects')).toBe(true);
  });

  test('context is transaction-local and does not leak', async () => {
    await withTenant(db, { userId: 1 }, (trx) => trx.raw('select 1'));
    const r = await db.raw("select current_setting('app.current_user_id', true) as v");
    expect(r.rows[0].v || '').toBe('');
  });
});
