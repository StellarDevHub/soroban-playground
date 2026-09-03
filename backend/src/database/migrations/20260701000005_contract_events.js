/**
 * Migration V004b: Contract events indexed from Soroban RPC
 *
 * Converted from backend/migrations/V004__contract_events.up.sql
 *
 * Note: The raw migrations folder contained two files both named V004__.
 * This one (V004b) covers the contract_events and contract_event_cursor tables.
 * V004a (20260701000004) covers CORS + webhooks.
 */

export async function up(knex) {
  await knex.schema.createTable('contract_events', (table) => {
    table.increments('id').primary();
    table.string('contract_id', 255).notNullable();
    table.integer('ledger_sequence').notNullable();
    table.text('topics').notNullable();
    table.text('value').nullable();
    table.text('raw_xdr').nullable();
    table.string('event_type', 50).defaultTo('contract');
    table.timestamp('indexed_at').defaultTo(knex.fn.now());

    table.index('contract_id', 'idx_ce_contract_id');
    table.index('ledger_sequence', 'idx_ce_ledger');
  });

  // Single-row cursor table: stores the last processed ledger so the indexer
  // can resume without gaps after a restart.
  await knex.schema.createTable('contract_event_cursor', (table) => {
    table.integer('id').primary().defaultTo(1);
    table.string('cursor', 255).notNullable();
    table.integer('last_ledger').nullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('contract_event_cursor');
  await knex.schema.dropTableIfExists('contract_events');
}
