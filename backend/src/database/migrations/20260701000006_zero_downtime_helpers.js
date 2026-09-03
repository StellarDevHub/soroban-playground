/**
 * Migration V005: Zero-downtime phase tracking column
 *
 * Converted from backend/migrations/V005__zero_downtime_helpers.up.sql
 *
 * Adds a nullable `phase` column to the knex_migrations table so that
 * expand-and-contract deployment patterns can be tracked.
 *
 * Notes:
 *  - The column is nullable with a DEFAULT so it is backward-compatible
 *    and requires no table lock on either SQLite or PostgreSQL.
 *  - On SQLite < 3.35 DROP COLUMN is not supported, so the down() migration
 *    is a documented no-op for that dialect.  On PostgreSQL, the column is
 *    properly removed.
 */

export async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('knex_migrations', 'phase');
  if (!hasColumn) {
    await knex.schema.table('knex_migrations', (table) => {
      table.string('phase', 50).nullable().defaultTo(null);
    });
  }
}

export async function down(knex) {
  const isPg = knex.client.config.client === 'pg';

  if (isPg) {
    const hasColumn = await knex.schema.hasColumn('knex_migrations', 'phase');
    if (hasColumn) {
      await knex.schema.table('knex_migrations', (table) => {
        table.dropColumn('phase');
      });
    }
  }
  // SQLite < 3.35 does not support DROP COLUMN.
  // The phase column is nullable with DEFAULT NULL and is backward-compatible
  // to leave in place.  No destructive action required for rollback on SQLite.
}
