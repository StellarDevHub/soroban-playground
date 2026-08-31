/**
 * Migration V004a: CORS whitelist and webhook delivery engine
 *
 * Converted from backend/migrations/V004__add_webhooks_and_cors_whitelist.up.sql
 *
 * Note: The raw migrations folder contained two files both named V004__.
 * This one (V004a) covers CORS + webhooks.
 * V004b (20260701000005) covers contract events.
 * Both are valid and non-conflicting — they create different tables.
 */

export async function up(knex) {
  await knex.schema.createTable('cors_whitelist', (table) => {
    table.increments('id').primary();
    table.string('origin', 500).notNullable().unique();
    table.boolean('active').notNullable().defaultTo(true);
    table.string('added_by', 255).nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('webhook_subscriptions', (table) => {
    table.string('id', 36).primary().comment('UUID');
    table.text('url').notNullable();
    table.text('events').notNullable().defaultTo('[]').comment('JSON array of event types');
    table.string('secret', 255).notNullable();
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('webhook_deliveries', (table) => {
    table.string('id', 36).primary().comment('UUID');
    table.string('subscription_id', 36).notNullable().references('id').inTable('webhook_subscriptions').onDelete('CASCADE');
    table.string('event_type', 100).notNullable();
    table.text('payload').notNullable();
    table
      .enu('status', ['pending', 'success', 'failed', 'retrying'], {
        useNative: false,
      })
      .notNullable()
      .defaultTo('pending');
    table.integer('attempt').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at').defaultTo(knex.fn.now());
    table.integer('response_status').nullable();
    table.text('response_body').nullable();
    table.timestamp('delivered_at').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index(['status', 'next_attempt_at'], 'idx_webhook_deliveries_status_next');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('webhook_deliveries');
  await knex.schema.dropTableIfExists('webhook_subscriptions');
  await knex.schema.dropTableIfExists('cors_whitelist');
}
