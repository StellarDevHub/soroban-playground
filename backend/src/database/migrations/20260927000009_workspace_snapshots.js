/**
 * Migration V009: Workspace cloud sync (issue #1526)
 *
 * One row per (tenant, wallet) holding the merged workspace snapshot:
 * favorites, the append-only deployment/compile history, and the editor
 * workspace document. `revision` gives clients an optimistic-concurrency token
 * so an offline device cannot silently clobber a newer snapshot.
 *
 * Uses the knex schema builder so it works with both SQLite and PostgreSQL.
 */

export async function up(knex) {
  const exists = await knex.schema.hasTable('workspace_snapshots');
  if (exists) return;

  await knex.schema.createTable('workspace_snapshots', (table) => {
    table.increments('id').primary();
    table
      .string('tenant_id', 128)
      .notNullable()
      .defaultTo('public')
      .comment('Tenant that owns the snapshot');
    table
      .string('wallet_address', 64)
      .notNullable()
      .comment('Stellar account (G...) the snapshot belongs to');
    table
      .text('favorites')
      .notNullable()
      .defaultTo('[]')
      .comment('JSON array of favorite contract template ids');
    table
      .text('history')
      .notNullable()
      .defaultTo('[]')
      .comment('JSON array of deployment/compile history entries');
    table
      .text('workspace')
      .notNullable()
      .defaultTo('{}')
      .comment('JSON editor workspace document');
    table.string('device_id', 64).nullable().comment('Last writer device id');
    table
      .integer('revision')
      .notNullable()
      .defaultTo(0)
      .comment('Monotonic optimistic-concurrency token');
    table.string('updated_at', 50).notNullable();

    table.unique(['tenant_id', 'wallet_address'], {
      indexName: 'uq_workspace_snapshots_tenant_wallet',
    });
    table.index('updated_at', 'idx_workspace_snapshots_updated_at');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('workspace_snapshots');
}
