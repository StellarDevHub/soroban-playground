import fs from 'node:fs';
import path from 'node:path';
import knexLib from 'knex';
import { withTenant } from '../src/database/tenantContext.js';
import { up as applyPartitioning } from '../src/database/migrations/20261021000010_partition_audit_log.js';
import { up as applyRls } from '../src/database/migrations/20261021000011_rls_policies.js';

const enabled = process.env.DATABASE_CLIENT === 'pg' && process.env.DATABASE_URL;
const suite = enabled ? describe : describe.skip;

const ym = (d) => `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

suite('audit_log monthly partitioning', () => {
  let db;
  const now = new Date();
  const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const ensure = async (back, ahead) =>
    (await db.raw('SELECT ensure_audit_log_partitions(?, ?) AS n', [back, ahead])).rows[0].n;

  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: process.env.DATABASE_URL });
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'tests/fixtures/pg-tenant-schema.sql'), 'utf8');
    await db.raw(schema);
    await db('audit_log').insert([
      { tenant_id: 'user:1', user_id: 1, action: 'request', timestamp: new Date() },
      { tenant_id: 'user:1', user_id: 1, action: 'request', timestamp: new Date(Date.now() - 40 * 864e5) },
      { tenant_id: 'user:2', user_id: 2, action: 'request', timestamp: new Date() },
    ]);
    await applyPartitioning(db);
    await applyRls(db);
  });
  afterAll(async () => { await db.destroy(); });

  test('audit_log is range partitioned and legacy rows survive', async () => {
    const kind = (await db.raw(`SELECT relkind FROM pg_class WHERE oid = 'public.audit_log'::regclass`)).rows[0].relkind;
    expect(kind).toBe('p');
    expect(Number((await db('audit_log').count('* as c').first()).c)).toBe(3);
    expect(await db.schema.hasTable('audit_log_legacy')).toBe(false);
  });

  test('partition creation is idempotent', async () => {
    expect(await ensure(0, 3)).toBe(0);
    expect(await ensure(0, 5)).toBe(2);
    expect(await ensure(0, 5)).toBe(0);
  });

  test('time-range queries prune to a single partition', async () => {
    const plan = (await db.raw(
      `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF)
       SELECT * FROM audit_log WHERE "timestamp" >= ? AND "timestamp" < ?`,
      [thisMonth.toISOString(), nextMonth.toISOString()],
    )).rows.map((r) => r['QUERY PLAN']).join('\n');
    console.log(plan);
    expect(plan).toContain(`audit_log_${ym(thisMonth)}`);
    expect(plan).not.toContain(`audit_log_${ym(nextMonth)}`);
  });

  test('RLS still isolates tenants through the partitioned table', async () => {
    const count = (userId) =>
      withTenant(db, { userId }, async (trx) => Number((await trx('audit_log').count('* as c').first()).c));
    expect(await count(1)).toBe(2);
    expect(await count(2)).toBe(1);
    expect(await count(999)).toBe(0);
  });

  test('tenant role cannot bypass RLS by reading a partition directly', async () => {
    await expect(
      withTenant(db, { userId: 1 }, (trx) => trx.raw(`SELECT * FROM audit_log_${ym(thisMonth)}`)),
    ).rejects.toThrow(/permission denied/i);
  });

  test('concurrent partition creation does not error or deadlock', async () => {
    await Promise.all(Array.from({ length: 5 }, () => ensure(0, 8)));
    expect(await ensure(0, 8)).toBe(0);
  });
});
