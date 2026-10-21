/**
 * Range-partition audit_log by month (Postgres only; no-op elsewhere).
 * Partitions are created lock-light: build a standalone table, add a CHECK that
 * proves the range, then ATTACH PARTITION (skips the validation scan and only
 * takes a SHARE UPDATE EXCLUSIVE lock on the parent). No DEFAULT partition on
 * purpose: attaching next to one would scan and lock it.
 */
const ENSURE_FN = `
CREATE OR REPLACE FUNCTION ensure_audit_log_partitions(months_back int DEFAULT 0, months_ahead int DEFAULT 3)
RETURNS int LANGUAGE plpgsql SET lock_timeout = '3s' AS $fn$
DECLARE
  base date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  m date; nxt date; part text; created int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ensure_audit_log_partitions')) THEN
    RETURN 0;
  END IF;
  FOR i IN -months_back..months_ahead LOOP
    m := (base + make_interval(months => i))::date;
    nxt := (m + interval '1 month')::date;
    part := 'audit_log_' || to_char(m, 'YYYY_MM');
    IF to_regclass(format('public.%I', part)) IS NULL THEN
      EXECUTE format('CREATE TABLE public.%I (LIKE public.audit_log INCLUDING DEFAULTS)', part);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ("timestamp" >= %L AND "timestamp" < %L)',
        part, part || '_range', m::text || ' 00:00:00+00', nxt::text || ' 00:00:00+00');
      EXECUTE format(
        'ALTER TABLE public.audit_log ATTACH PARTITION public.%I FOR VALUES FROM (%L) TO (%L)',
        part, m::text || ' 00:00:00+00', nxt::text || ' 00:00:00+00');
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END
$fn$;`;

const relkind = async (knex) =>
  (await knex.raw(`SELECT relkind FROM pg_class WHERE oid = 'public.audit_log'::regclass`)).rows[0].relkind;

const handOverSequence = (from, to) => `
DO $$ DECLARE s text; BEGIN
  s := pg_get_serial_sequence('${from}', 'id');
  IF s IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s OWNED BY ${to}.id', s); END IF;
END $$;`;

export async function up(knex) {
  if (knex.client.dialect !== 'postgresql') return;
  if (!(await knex.schema.hasTable('audit_log'))) return;

  await knex.raw(ENSURE_FN);
  if ((await relkind(knex)) === 'p') return; // already partitioned

  await knex.raw(`ALTER TABLE audit_log RENAME TO audit_log_legacy`);
  await knex.raw(`
    DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT indexname FROM pg_indexes
               WHERE schemaname = 'public' AND tablename = 'audit_log_legacy' LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, left(r.indexname, 50) || '_legacy');
      END LOOP;
    END $$;`);
  await knex.raw(`UPDATE audit_log_legacy SET "timestamp" = now() WHERE "timestamp" IS NULL`);

  await knex.raw(`CREATE TABLE audit_log (LIKE audit_log_legacy INCLUDING DEFAULTS) PARTITION BY RANGE ("timestamp")`);
  await knex.raw(`ALTER TABLE audit_log ALTER COLUMN "timestamp" SET NOT NULL, ALTER COLUMN "timestamp" SET DEFAULT now()`);
  await knex.raw(`ALTER TABLE audit_log ADD PRIMARY KEY (id, "timestamp")`);
  await knex.raw(`CREATE INDEX idx_audit_log_tenant_ts ON audit_log (tenant_id, "timestamp")`);
  await knex.raw(`CREATE INDEX idx_audit_log_api_key_ts ON audit_log (api_key_id, "timestamp")`);
  await knex.raw(`CREATE INDEX idx_audit_log_ts ON audit_log ("timestamp")`);

  // Partitions from the oldest legacy row through 3 months ahead.
  const { oldest } = (await knex.raw(`SELECT min("timestamp") AS oldest FROM audit_log_legacy`)).rows[0];
  let back = 0;
  if (oldest) {
    const n = new Date();
    back = Math.max(0, (n.getUTCFullYear() - oldest.getUTCFullYear()) * 12 + (n.getUTCMonth() - oldest.getUTCMonth()));
  }
  await knex.raw('SELECT ensure_audit_log_partitions(?, 3)', [back]);

  await knex.raw(`INSERT INTO audit_log SELECT * FROM audit_log_legacy`);
  await knex.raw(handOverSequence('audit_log_legacy', 'audit_log'));
  await knex.raw(`DROP TABLE audit_log_legacy`);
}

export async function down(knex) {
  if (knex.client.dialect !== 'postgresql') return;
  if (await knex.schema.hasTable('audit_log')) {
    if ((await relkind(knex)) === 'p') {
      await knex.raw(`CREATE TABLE audit_log_flat (LIKE audit_log INCLUDING DEFAULTS)`);
      await knex.raw(`INSERT INTO audit_log_flat SELECT * FROM audit_log`);
      await knex.raw(handOverSequence('audit_log', 'audit_log_flat'));
      await knex.raw(`DROP TABLE audit_log`);
      await knex.raw(`ALTER TABLE audit_log_flat RENAME TO audit_log`);
      await knex.raw(`ALTER TABLE audit_log ADD PRIMARY KEY (id)`);
      await knex.raw(`CREATE INDEX idx_audit_log_tenant_ts ON audit_log (tenant_id, "timestamp")`);
      await knex.raw(`CREATE INDEX idx_audit_log_api_key_ts ON audit_log (api_key_id, "timestamp")`);
      await knex.raw(`CREATE INDEX idx_audit_log_ts ON audit_log ("timestamp")`);
    }
  }
  await knex.raw(`DROP FUNCTION IF EXISTS ensure_audit_log_partitions(int, int)`);
}
