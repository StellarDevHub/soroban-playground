/**
 * Kafka ledger ingestion idempotency.
 *
 * The consumer commits Kafka offsets manually after each batch. A node can
 * still crash after writing rows but before the commit is acknowledged, so
 * redelivery is expected. `event_key` makes the database insert idempotent:
 * repeated messages resolve to the same key and ON CONFLICT DO NOTHING keeps
 * the table free of duplicates.
 */

export async function up(knex) {
  await knex.schema.alterTable('contract_events', (table) => {
    table.string('event_key', 64).nullable();
    table.string('kafka_topic', 255).nullable();
    table.integer('kafka_partition').nullable();
    table.string('kafka_offset', 255).nullable();
  });

  await knex.raw(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_ce_event_key ON contract_events(event_key)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_ce_kafka_position ON contract_events(kafka_topic, kafka_partition, kafka_offset)'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_ce_kafka_position');
  await knex.raw('DROP INDEX IF EXISTS idx_ce_event_key');
  await knex.schema.alterTable('contract_events', (table) => {
    table.dropColumn('kafka_offset');
    table.dropColumn('kafka_partition');
    table.dropColumn('kafka_topic');
    table.dropColumn('event_key');
  });
}
