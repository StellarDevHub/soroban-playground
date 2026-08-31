/**
 * Migration V003: Synthetic assets tables
 *
 * Converted from backend/migrations/V003__synthetic_assets.up.sql
 *
 * The raw SQL used PostgreSQL-only features that are not portable:
 *   - SERIAL PRIMARY KEY  → table.increments() (works on both)
 *   - TIMESTAMP WITH TIME ZONE → table.timestamp() (Knex normalises this)
 *   - JSONB               → table.jsonb() on PG; falls back to text on SQLite
 *   - INDEX inside CREATE TABLE → table.index() (valid in both dialects)
 *
 * Knex schema builder handles these differences transparently.
 */

export async function up(knex) {
  const isPg = knex.client.config.client === 'pg';

  // Positions table
  await knex.schema.createTable('positions', (table) => {
    table.increments('id').primary();
    table.bigInteger('position_id').notNullable().unique();
    table.string('user_address', 255).notNullable();
    table.string('asset_symbol', 50).notNullable();
    table.string('type', 20).notNullable().comment("'COLLATERAL' or 'TRADING'");
    table.string('status', 20).notNullable().defaultTo('OPEN').comment("'OPEN', 'CLOSED', 'LIQUIDATED'");

    // Collateral position fields
    table.bigInteger('collateral_amount').nullable();
    table.bigInteger('minted_amount').nullable();

    // Trading position fields
    table.bigInteger('margin').nullable();
    table.integer('leverage').nullable();
    table.string('direction', 10).nullable().comment("'LONG' or 'SHORT'");
    table.bigInteger('entry_price').nullable();
    table.bigInteger('notional').nullable();

    table.timestamps(true, true);

    table.index('position_id', 'idx_positions_position_id');
    table.index('user_address', 'idx_positions_user_address');
    table.index('asset_symbol', 'idx_positions_asset_symbol');
    table.index('status', 'idx_positions_status');
    table.index('created_at', 'idx_positions_created_at');
  });

  // Synthetic assets table
  await knex.schema.createTable('synthetic_assets', (table) => {
    table.increments('id').primary();
    table.string('symbol', 50).notNullable().unique();
    table.string('name', 255).notNullable();
    table.integer('decimals').notNullable();
    table.bigInteger('total_supply').defaultTo(0);

    table.timestamps(true, true);

    table.index('symbol', 'idx_synthetic_assets_symbol');
  });

  // Price history table
  await knex.schema.createTable('asset_prices', (table) => {
    table.increments('id').primary();
    table.string('asset_symbol', 50).notNullable().references('symbol').inTable('synthetic_assets');
    table.bigInteger('price').notNullable();
    table.integer('confidence').notNullable().comment('0-100');

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('asset_symbol', 'idx_asset_prices_symbol');
    table.index('created_at', 'idx_asset_prices_created_at');
  });

  // Events table — uses JSONB on PG, text on SQLite
  await knex.schema.createTable('synthetic_asset_events', (table) => {
    table.increments('id').primary();
    table.string('event_type', 50).notNullable().comment("'MINT', 'BURN', 'TRADE', 'LIQUIDATE', etc.");
    table.string('subject', 255).notNullable().comment('Position ID or asset symbol');

    if (isPg) {
      table.jsonb('details').notNullable();
    } else {
      table.text('details').notNullable().comment('JSON stored as text on SQLite');
    }

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('event_type', 'idx_events_event_type');
    table.index('subject', 'idx_events_subject');
    table.index('created_at', 'idx_events_created_at');
  });

  // Liquidation alerts table
  await knex.schema.createTable('liquidation_alerts', (table) => {
    table.increments('id').primary();
    table.bigInteger('position_id').notNullable().unique().references('position_id').inTable('positions');
    table.timestamp('alerted_at').defaultTo(knex.fn.now());
    table.timestamp('resolved_at').nullable();

    table.index('position_id', 'idx_liquidation_position_id');
    table.index('alerted_at', 'idx_liquidation_alerted_at');
  });

  // Protocol parameters snapshot table
  await knex.schema.createTable('protocol_params_history', (table) => {
    table.increments('id').primary();
    table.integer('min_collateral_ratio').notNullable();
    table.integer('liquidation_threshold').notNullable();
    table.integer('liquidation_bonus').notNullable();
    table.integer('fee_percentage').notNullable();

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('created_at', 'idx_protocol_params_created_at');
  });

  // Collateral ratio history (analytics)
  await knex.schema.createTable('collateral_ratio_history', (table) => {
    table.increments('id').primary();
    table.bigInteger('position_id').notNullable().references('position_id').inTable('positions');
    table.bigInteger('ratio').notNullable();
    table.bigInteger('health_factor').notNullable();

    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('position_id', 'idx_collateral_ratio_position_id');
    table.index('created_at', 'idx_collateral_ratio_created_at');
  });

  // User positions summary (denormalised for quick lookups)
  await knex.schema.createTable('user_position_summary', (table) => {
    table.increments('id').primary();
    table.string('user_address', 255).notNullable().unique();
    table.bigInteger('total_collateral_deposited').defaultTo(0);
    table.bigInteger('total_synthetic_minted').defaultTo(0);
    table.bigInteger('total_trading_margin').defaultTo(0);
    table.integer('open_positions_count').defaultTo(0);
    table.integer('liquidated_positions_count').defaultTo(0);

    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.index('user_address', 'idx_user_position_summary_address');
  });

  // Composite indexes for common query patterns
  await knex.schema.table('positions', (table) => {
    table.index(['user_address', 'status'], 'idx_positions_user_status');
    table.index(['asset_symbol', 'status'], 'idx_positions_asset_status');
  });

  await knex.schema.table('synthetic_assets', (table) => {
    table.index('created_at', 'idx_synthetic_assets_created');
  });

  await knex.schema.table('synthetic_asset_events', (table) => {
    table.index(['event_type', 'created_at'], 'idx_events_timestamp');
  });
}

export async function down(knex) {
  // Drop in reverse dependency order
  await knex.schema.dropTableIfExists('collateral_ratio_history');
  await knex.schema.dropTableIfExists('user_position_summary');
  await knex.schema.dropTableIfExists('protocol_params_history');
  await knex.schema.dropTableIfExists('liquidation_alerts');
  await knex.schema.dropTableIfExists('synthetic_asset_events');
  await knex.schema.dropTableIfExists('asset_prices');
  await knex.schema.dropTableIfExists('positions');
  await knex.schema.dropTableIfExists('synthetic_assets');
}
