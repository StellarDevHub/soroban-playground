/**
 * Migration V002: Add rate limiting and API key management tables
 *
 * Converted from backend/migrations/V002__add_rate_limiting.up.sql
 * Uses knex schema builder so it works with both SQLite and PostgreSQL.
 *
 * Changes from raw SQL:
 *  - AUTOINCREMENT/SERIAL handled by table.increments()
 *  - CHECK constraints expressed via knex.raw() where needed
 *  - Indexes declared inside createTable for both dialects
 */

export async function up(knex) {
  // Organizations table — must exist before api_keys references it
  await knex.schema.createTable('organizations', (table) => {
    table.increments('id').primary();
    table.string('name', 255).notNullable().unique();
    table.text('description');
    table.timestamps(true, true);
  });

  // API keys table
  await knex.schema.createTable('api_keys', (table) => {
    table.increments('id').primary();
    table.string('key_hash', 64).notNullable().unique().comment('SHA-256 hash of the API key');
    table.string('key_prefix', 16).notNullable().comment('First 8 characters for lookup');
    table.string('name', 255).notNullable();
    table.text('description');
    table
      .enu('tier', ['free', 'standard', 'premium', 'admin'], {
        useNative: false,
      })
      .notNullable();
    table
      .enu('status', ['active', 'revoked', 'expired'], {
        useNative: false,
      })
      .notNullable()
      .defaultTo('active');
    table.integer('user_id').unsigned().references('id').inTable('users').onDelete('SET NULL');
    table.integer('organization_id').unsigned().references('id').inTable('organizations').onDelete('SET NULL');
    table.timestamps(true, true);
    table.timestamp('expires_at').nullable();
    table.timestamp('last_used_at').nullable();
    table.integer('usage_count').defaultTo(0);

    table.index('key_prefix', 'idx_api_keys_key_prefix');
    table.index('user_id', 'idx_api_keys_user_id');
    table.index('status', 'idx_api_keys_status');
  });

  // Rate limit usage tracking
  await knex.schema.createTable('rate_limit_usage', (table) => {
    table.increments('id').primary();
    table.integer('api_key_id').unsigned().notNullable().references('id').inTable('api_keys');
    table.string('endpoint', 500).notNullable();
    table.integer('request_count').notNullable().defaultTo(1);
    table.timestamp('window_start').notNullable();
    table.timestamp('window_end').notNullable();
    table
      .enu('tier', ['free', 'standard', 'premium', 'admin'], {
        useNative: false,
      })
      .notNullable();

    table.index(['api_key_id', 'window_start', 'window_end'], 'idx_rate_limit_usage_api_key_window');
  });

  // Tier limits configuration
  await knex.schema.createTable('tier_limits', (table) => {
    table.increments('id').primary();
    table
      .enu('tier', ['free', 'standard', 'premium', 'admin'], {
        useNative: false,
      })
      .notNullable()
      .unique();
    table.integer('requests_per_minute').notNullable();
    table.integer('requests_per_hour').notNullable();
    table.integer('requests_per_day').notNullable();
    table.integer('burst_limit').notNullable();
    table.timestamps(true, true);
  });

  // Audit log for API access
  await knex.schema.createTable('audit_log', (table) => {
    table.increments('id').primary();
    table.integer('api_key_id').unsigned().nullable().references('id').inTable('api_keys');
    table.integer('user_id').unsigned().nullable().references('id').inTable('users');
    table.string('action', 100).notNullable().comment('request, key_generated, key_revoked, etc.');
    table.string('endpoint', 500).nullable();
    table.string('ip_address', 45).nullable();
    table.text('user_agent').nullable();
    table.integer('status_code').nullable();
    table.integer('response_time_ms').nullable();
    table.timestamp('timestamp').defaultTo(knex.fn.now());
    table.text('metadata').nullable().comment('JSON for additional data');

    table.index(['api_key_id', 'timestamp'], 'idx_audit_log_api_key_timestamp');
    table.index('timestamp', 'idx_audit_log_timestamp');
  });

  // Seed default tier limits
  await knex('tier_limits').insert([
    { tier: 'free',     requests_per_minute: 10,    requests_per_hour: 100,    requests_per_day: 1000,    burst_limit: 20 },
    { tier: 'standard', requests_per_minute: 100,   requests_per_hour: 1000,   requests_per_day: 10000,   burst_limit: 200 },
    { tier: 'premium',  requests_per_minute: 1000,  requests_per_hour: 10000,  requests_per_day: 100000,  burst_limit: 2000 },
    { tier: 'admin',    requests_per_minute: 10000, requests_per_hour: 100000, requests_per_day: 1000000, burst_limit: 20000 },
  ]);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('rate_limit_usage');
  await knex.schema.dropTableIfExists('tier_limits');
  await knex.schema.dropTableIfExists('api_keys');
  await knex.schema.dropTableIfExists('organizations');
}
