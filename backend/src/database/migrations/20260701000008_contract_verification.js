/**
 * Migration V007: Contract source and bytecode verification
 *
 * Converted from backend/migrations/V007__contract_verification.up.sql
 * Uses knex schema builder so it works with both SQLite and PostgreSQL.
 */

export async function up(knex) {
  await knex.schema.createTable('contract_verification', (table) => {
    table.string('id', 36).primary().comment('UUID');
    table.string('contract_id', 255).notNullable();
    table.string('network', 50).notNullable();
    table.text('source_code').notNullable();
    table.string('source_hash', 64).notNullable();
    table.text('dependencies').notNullable().defaultTo('{}').comment('JSON');
    table.text('metadata').notNullable().defaultTo('{}').comment('JSON');
    table.string('wasm_hash', 64).nullable();
    table.string('on_chain_wasm_hash', 64).nullable();
    table
      .enu('status', ['pending', 'verified', 'mismatch', 'failed'], {
        useNative: false,
      })
      .notNullable();
    table.string('error_code', 100).nullable();
    table.text('error_message').nullable();
    table.string('created_at', 50).notNullable();
    table.string('updated_at', 50).notNullable();
    table.string('verified_at', 50).nullable();

    table.index(['contract_id', 'network', 'updated_at'], 'idx_contract_verification_contract');
    table.index(['status', 'updated_at'], 'idx_contract_verification_status');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('contract_verification');
}
