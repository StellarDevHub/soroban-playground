/**
 * Migration V001: Create users table
 *
 * Converted from backend/migrations/V001__create_users_table.up.sql
 * Uses knex schema builder so it works with both SQLite and PostgreSQL.
 */

export async function up(knex) {
  if (knex.client.dialect === 'postgresql') {
    await knex.raw("SET lock_timeout = '3s'");
  }
  if (await knex.schema.hasTable('users')) return;
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('username', 255).notNullable().unique();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.timestamps(true, true); // created_at, updated_at with defaults
  });
}

export async function down(knex) {
  if (knex.client.dialect === 'postgresql') {
    await knex.raw("SET lock_timeout = '3s'");
  }
  await knex.schema.dropTableIfExists('users');
}
