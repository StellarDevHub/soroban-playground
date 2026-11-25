/**
 * Range-partition contract_events by month on `indexed_at` (Postgres only;
 * no-op elsewhere).
 *
 * Partitions are created lock-light: build a standalone table, add a CHECK
 * constraint proving the range, then ATTACH PARTITION (skips the validation
 * scan and only takes a SHARE UPDATE EXCLUSIVE lock on the parent).
 */
const ENSURE_FN = `
CREATE OR REPLACE FUNCTION ensure_contract_events_partitions(months_back int DEFAULT 0, months_ahead int DEFAULT 3)
RETURNS int LANGUAGE plpgsql SET lock_timeout = '3s' AS $fn$
DECLARE
  base date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  m date; nxt date; part text; created int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ensure_contract_events_partitions')) THEN
    RETURN 0;
  END IF;
  FOR i IN -months_back..months_ahead LOOP
    m := (base + make_interval(months => i))::date;
    nxt := (m + interval '1 month')::date;
    part := 'contract_events_' || to_char(m, 'YYYY_MM');
    IF to_regclass(format('public.%I', part)) IS NULL THEN
      EXECUTE format('CREATE TABLE public.%I (LIKE public.contract_events INCLUDING DEFAULTS)', part);
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (indexed_at >= %L AND indexed_at < %L)',
        part, part || '_range', m::text || ' 00:00:00+00', nxt::text || ' 00:00:00+00');
      EXECUTE format(
        'ALTER TABLE public.contract_events ATTACH PARTITION public.%I FOR VALUES FROM (%L) TO (%L)',
        part, m::text || ' 00:00:00+00', nxt::text || ' 00:00:00+00');
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END
$fn$;`;

const relkind = async (knex) =>
  (
    await knex.raw(
      `SELECT relkind FROM pg_class WHERE oid = 'public.contract_events'::regclass`
    )
  ).rows[0].relkind;

const handOverSequence = (from, to) => `
DO $$ DECLARE s text; BEGIN
  s := pg_get_serial_sequence('${from}', 'id');
  IF s IS NOT NULL THEN EXECUTE format('ALTER SEQUENCE %s OWNED BY ${to}.id', s); END IF;
END $$;`;

export async function up(knex) {
  if (knex.client.dialect !== 'postgresql') return;
  await knex.raw("SET lock_timeout = '3s'");
  if (!(await knex.schema.hasTable('contract_events'))) return;

  await knex.raw(ENSURE_FN);
  if ((await relkind(knex)) === 'p') return; // already partitioned

  await knex.raw(`ALTER TABLE contract_events RENAME TO contract_events_legacy`);
  await knex.raw(`
    DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT indexname FROM pg_indexes
               WHERE schemaname = 'public' AND tablename = 'contract_events_legacy' LOOP
        EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, left(r.indexname, 50) || '_legacy');
      END LOOP;
    END $$;`);
  await knex.raw(
    `UPDATE contract_events_legacy SET indexed_at = now() WHERE indexed_at IS NULL`
  );

  await knex.raw(
    `CREATE TABLE contract_events (LIKE contract_events_legacy INCLUDING DEFAULTS) PARTITION BY RANGE (indexed_at)`
  );
  await knex.raw(
    `ALTER TABLE contract_events ALTER COLUMN indexed_at SET NOT NULL, ALTER COLUMN indexed_at SET DEFAULT now()`
  );
  await knex.raw(
    `ALTER TABLE contract_events ADD PRIMARY KEY (id, indexed_at)`
  );
  await knex.raw(
    `CREATE INDEX idx_ce_contract_id ON contract_events (contract_id, indexed_at)`
  );
  await knex.raw(
    `CREATE INDEX idx_ce_ledger ON contract_events (ledger_sequence)`
  );
  await knex.raw(
    `CREATE INDEX idx_ce_indexed_at ON contract_events (indexed_at)`
  );
  await knex.raw(
    `CREATE UNIQUE INDEX idx_ce_event_key ON contract_events (event_key, indexed_at)`
  );
  await knex.raw(
    `CREATE INDEX idx_ce_kafka_position ON contract_events (kafka_topic, kafka_partition, kafka_offset)`
  );

  // Partitions from the oldest legacy row through 3 months ahead.
  const { oldest } = (
    await knex.raw(
      `SELECT min(indexed_at) AS oldest FROM contract_events_legacy`
    )
  ).rows[0];
  let back = 0;
  if (oldest) {
    const n = new Date();
    back = Math.max(
      0,
      (n.getUTCFullYear() - oldest.getUTCFullYear()) * 12 +
        (n.getUTCMonth() - oldest.getUTCMonth())
    );
  }
  await knex.raw('SELECT ensure_contract_events_partitions(?, 3)', [back]);

  await knex.raw(
    `INSERT INTO contract_events SELECT * FROM contract_events_legacy`
  );
  await knex.raw(handOverSequence('contract_events_legacy', 'contract_events'));
  await knex.raw(`DROP TABLE contract_events_legacy`);
}

export async function down(knex) {
  if (knex.client.dialect !== 'postgresql') return;
  await knex.raw("SET lock_timeout = '3s'");
  if (await knex.schema.hasTable('contract_events')) {
    if ((await relkind(knex)) === 'p') {
      await knex.raw(
        `CREATE TABLE contract_events_flat (LIKE contract_events INCLUDING DEFAULTS)`
      );
      await knex.raw(
        `INSERT INTO contract_events_flat SELECT * FROM contract_events`
      );
      await knex.raw(
        handOverSequence('contract_events', 'contract_events_flat')
      );
      await knex.raw(`DROP TABLE contract_events`);
      await knex.raw(
        `ALTER TABLE contract_events_flat RENAME TO contract_events`
      );
      await knex.raw(`ALTER TABLE contract_events ADD PRIMARY KEY (id)`);
      await knex.raw(
        `CREATE INDEX idx_ce_contract_id ON contract_events (contract_id)`
      );
      await knex.raw(
        `CREATE INDEX idx_ce_ledger ON contract_events (ledger_sequence)`
      );
      await knex.raw(
        `CREATE UNIQUE INDEX idx_ce_event_key ON contract_events (event_key)`
      );
      await knex.raw(
        `CREATE INDEX idx_ce_kafka_position ON contract_events (kafka_topic, kafka_partition, kafka_offset)`
      );
    }
  }
  await knex.raw(
    `DROP FUNCTION IF EXISTS ensure_contract_events_partitions(int, int)`
  );
}
