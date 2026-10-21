import knexLib from 'knex';

/**
 * Keeps upcoming monthly audit_log partitions created ahead of time.
 * Safe to run on every app instance: the SQL function takes an advisory lock,
 * and a lock_timeout makes it back off instead of queueing behind other work.
 * No-op on non-Postgres databases.
 */
export function startAuditPartitionWorker(
  knex,
  { intervalMs = 6 * 60 * 60 * 1000, monthsAhead = 3, logger = console } = {},
) {
  if (knex.client.dialect !== 'postgresql') return { stop() {}, tick: async () => 0 };

  const tick = async () => {
    try {
      const { rows } = await knex.raw('SELECT ensure_audit_log_partitions(0, ?) AS created', [monthsAhead]);
      const created = rows[0].created;
      if (created > 0) logger.info?.(`audit_log: created ${created} partition(s)`);
      return created;
    } catch (err) {
      logger.warn?.(`audit_log partition worker failed (will retry): ${err.message}`);
      return 0;
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}

/**
 * App entry point. The app's runtime database is SQLite today; partitions only
 * exist on Postgres, so this starts only when DATABASE_CLIENT=pg and
 * DATABASE_URL are set. It uses its own 2-connection pool, so it never competes
 * with request traffic.
 */
export function startAuditPartitionWorkerFromEnv(options = {}) {
  if (process.env.DATABASE_CLIENT !== 'pg' || !process.env.DATABASE_URL) {
    return { stop: async () => {}, tick: async () => 0 };
  }
  const knex = knexLib({
    client: 'pg',
    connection: process.env.DATABASE_URL,
    pool: { min: 0, max: 2 },
  });
  const worker = startAuditPartitionWorker(knex, options);
  return {
    tick: worker.tick,
    stop: async () => {
      worker.stop();
      await knex.destroy();
    },
  };
}
