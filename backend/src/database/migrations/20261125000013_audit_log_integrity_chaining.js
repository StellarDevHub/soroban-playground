/**
 * Adds cryptographic hash-chaining columns (actor, prev_hash, record_hash) to
 * audit_log and creates audit_log_anchors for hourly root state hash anchoring.
 * Works on both PostgreSQL (including monthly-partitioned audit_log) and SQLite.
 */
export async function up(knex) {
  if (await knex.schema.hasTable('audit_log')) {
    const hasActor = await knex.schema.hasColumn('audit_log', 'actor');
    const hasPrevHash = await knex.schema.hasColumn('audit_log', 'prev_hash');
    const hasRecordHash = await knex.schema.hasColumn('audit_log', 'record_hash');

    await knex.schema.alterTable('audit_log', (table) => {
      if (!hasActor) {
        table.text('actor');
      }
      if (!hasPrevHash) {
        table.string('prev_hash', 64);
      }
      if (!hasRecordHash) {
        table.string('record_hash', 64);
      }
    });

    if (knex.client.dialect === 'postgresql') {
      await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_audit_log_record_hash ON audit_log (record_hash)`
      );
    } else {
      await knex.raw(
        `CREATE INDEX IF NOT EXISTS idx_audit_log_record_hash ON audit_log (record_hash)`
      );
    }
  }

  if (!(await knex.schema.hasTable('audit_log_anchors'))) {
    await knex.schema.createTable('audit_log_anchors', (table) => {
      table.increments('id').primary();
      table.timestamp('hour_start').notNullable();
      table.timestamp('hour_end').notNullable();
      table.integer('record_count').notNullable().defaultTo(0);
      table.string('root_hash', 64).notNullable();
      table.string('anchor_type', 32).notNullable().defaultTo('local');
      table.text('anchor_ref');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.index(['hour_start', 'hour_end'], 'idx_audit_log_anchors_window');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('audit_log_anchors');

  if (await knex.schema.hasTable('audit_log')) {
    await knex.raw(`DROP INDEX IF EXISTS idx_audit_log_record_hash`);
    const hasActor = await knex.schema.hasColumn('audit_log', 'actor');
    const hasPrevHash = await knex.schema.hasColumn('audit_log', 'prev_hash');
    const hasRecordHash = await knex.schema.hasColumn('audit_log', 'record_hash');

    await knex.schema.alterTable('audit_log', (table) => {
      if (hasRecordHash) table.dropColumn('record_hash');
      if (hasPrevHash) table.dropColumn('prev_hash');
      if (hasActor) table.dropColumn('actor');
    });
  }
}
