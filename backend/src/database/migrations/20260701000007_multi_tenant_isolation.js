/**
 * Migration V006: Multi-tenant isolation
 *
 * Converted from backend/migrations/V006__multi_tenant_isolation.up.sql
 *
 * Adds tenant_id columns to all relevant tables and rebuilds the
 * favorites and popular_searches tables with tenant-scoped unique keys.
 *
 * Assumptions:
 *  - The tables altered here (files, projects, search_analytics, api_keys,
 *    rate_limit_usage, audit_log, webhook_subscriptions, webhook_deliveries,
 *    favorites, popular_searches) were created by earlier migrations or the
 *    existing 20260630000000_initial_schema.js.
 *  - We check for column existence before adding to make this migration
 *    idempotent and safe to re-run on partially-migrated databases.
 */

async function addTenantId(knex, tableName) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) return;

  const hasCol = await knex.schema.hasColumn(tableName, 'tenant_id');
  if (hasCol) return;

  await knex.schema.table(tableName, (table) => {
    table.string('tenant_id', 255).notNullable().defaultTo('public');
  });
}

export async function up(knex) {
  // Add tenant_id to each affected table
  const tables = [
    'files',
    'projects',
    'search_analytics',
    'api_keys',
    'rate_limit_usage',
    'audit_log',
    'webhook_subscriptions',
    'webhook_deliveries',
  ];

  for (const t of tables) {
    await addTenantId(knex, t);
  }

  // Backfill api_keys.tenant_id based on organization_id / user_id
  const apiKeysExists = await knex.schema.hasTable('api_keys');
  if (apiKeysExists) {
    await knex.raw(`
      UPDATE api_keys
      SET tenant_id =
        CASE
          WHEN organization_id IS NOT NULL THEN 'org:' || CAST(organization_id AS TEXT)
          WHEN user_id IS NOT NULL THEN 'user:' || CAST(user_id AS TEXT)
          ELSE 'public'
        END
      WHERE tenant_id = 'public'
    `);

    await knex.raw(`
      UPDATE audit_log
      SET tenant_id = COALESCE(
        (SELECT tenant_id FROM api_keys WHERE api_keys.id = audit_log.api_key_id),
        CASE
          WHEN user_id IS NOT NULL THEN 'user:' || CAST(user_id AS TEXT)
          ELSE 'public'
        END
      )
      WHERE tenant_id = 'public'
    `);

    await knex.raw(`
      UPDATE rate_limit_usage
      SET tenant_id = COALESCE(
        (SELECT tenant_id FROM api_keys WHERE api_keys.id = rate_limit_usage.api_key_id),
        'public'
      )
      WHERE tenant_id = 'public'
    `);
  }

  // Rebuild popular_searches with (tenant_id, query) unique constraint
  const hasPop = await knex.schema.hasTable('popular_searches');
  if (hasPop) {
    const hasTenantCol = await knex.schema.hasColumn('popular_searches', 'tenant_id');
    if (!hasTenantCol) {
      // Create new table, migrate data, then rename
      await knex.schema.createTable('popular_searches_new', (table) => {
        table.increments('id').primary();
        table.string('tenant_id', 255).notNullable().defaultTo('public');
        table.string('query', 1000).notNullable();
        table.integer('search_count').defaultTo(1);
        table.timestamp('last_updated').defaultTo(knex.fn.now());
        table.unique(['tenant_id', 'query'], { indexName: 'uq_popular_searches_tenant_query' });
      });

      await knex.raw(`
        INSERT INTO popular_searches_new (tenant_id, query, search_count, last_updated)
        SELECT 'public', query, search_count, last_updated FROM popular_searches
      `);

      await knex.schema.dropTable('popular_searches');
      await knex.schema.renameTable('popular_searches_new', 'popular_searches');
    }
  }

  // Rebuild favorites with (tenant_id, wallet_address) unique constraint
  const hasFav = await knex.schema.hasTable('favorites');
  if (hasFav) {
    const hasTenantCol = await knex.schema.hasColumn('favorites', 'tenant_id');
    if (!hasTenantCol) {
      await knex.schema.createTable('favorites_new', (table) => {
        table.increments('id').primary();
        table.string('tenant_id', 255).notNullable().defaultTo('public');
        table.string('wallet_address', 255).notNullable();
        table.text('favorites').notNullable().defaultTo('[]');
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.unique(['tenant_id', 'wallet_address'], { indexName: 'uq_favorites_tenant_wallet' });
      });

      await knex.raw(`
        INSERT INTO favorites_new (tenant_id, wallet_address, favorites, updated_at)
        SELECT 'public', wallet_address, favorites, updated_at FROM favorites
      `);

      await knex.schema.dropTable('favorites');
      await knex.schema.renameTable('favorites_new', 'favorites');
    }
  }

  // Tenant-scoped indexes
  const indexSpecs = [
    { table: 'projects',              cols: ['tenant_id'],                                 name: 'idx_projects_tenant' },
    { table: 'files',                 cols: ['tenant_id'],                                 name: 'idx_files_tenant' },
    { table: 'search_analytics',      cols: ['tenant_id', 'timestamp'],                    name: 'idx_search_analytics_tenant_ts' },
    { table: 'popular_searches',      cols: ['tenant_id', 'search_count'],                 name: 'idx_popular_searches_tenant_count' },
    { table: 'api_keys',              cols: ['tenant_id'],                                 name: 'idx_api_keys_tenant_id' },
    { table: 'rate_limit_usage',      cols: ['tenant_id', 'window_start', 'window_end'],   name: 'idx_rate_limit_usage_tenant_window' },
    { table: 'audit_log',             cols: ['tenant_id', 'timestamp'],                    name: 'idx_audit_log_tenant_ts' },
    { table: 'webhook_subscriptions', cols: ['tenant_id', 'active'],                       name: 'idx_webhook_subs_tenant_active' },
    { table: 'webhook_deliveries',    cols: ['tenant_id', 'created_at'],                   name: 'idx_webhook_del_tenant_created' },
  ];

  for (const { table, cols, name } of indexSpecs) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) continue;

    // Check that all columns actually exist before creating the index
    const colChecks = await Promise.all(cols.map((c) => knex.schema.hasColumn(table, c)));
    if (colChecks.every(Boolean)) {
      await knex.schema.table(table, (t) => {
        t.index(cols, name);
      }).catch(() => {
        // Index may already exist — swallow the error
      });
    }
  }

  // Unique index on rate_limit_usage to prevent duplicate windows
  const hasRlu = await knex.schema.hasTable('rate_limit_usage');
  if (hasRlu) {
    await knex.schema.table('rate_limit_usage', (t) => {
      t.unique(['api_key_id', 'endpoint', 'window_start', 'window_end'], {
        indexName: 'idx_rate_limit_usage_unique',
      });
    }).catch(() => {});
  }
}

export async function down(knex) {
  // Drop tenant-scoped indexes first
  const indexDrops = [
    { table: 'projects',              name: 'idx_projects_tenant' },
    { table: 'files',                 name: 'idx_files_tenant' },
    { table: 'search_analytics',      name: 'idx_search_analytics_tenant_ts' },
    { table: 'popular_searches',      name: 'idx_popular_searches_tenant_count' },
    { table: 'api_keys',              name: 'idx_api_keys_tenant_id' },
    { table: 'rate_limit_usage',      name: 'idx_rate_limit_usage_tenant_window' },
    { table: 'rate_limit_usage',      name: 'idx_rate_limit_usage_unique' },
    { table: 'audit_log',             name: 'idx_audit_log_tenant_ts' },
    { table: 'webhook_subscriptions', name: 'idx_webhook_subs_tenant_active' },
    { table: 'webhook_deliveries',    name: 'idx_webhook_del_tenant_created' },
  ];

  for (const { table, name } of indexDrops) {
    const exists = await knex.schema.hasTable(table);
    if (exists) {
      await knex.schema.table(table, (t) => {
        t.dropIndex([], name);
      }).catch(() => {});
    }
  }

  // Rebuild favorites without tenant_id
  const hasFav = await knex.schema.hasTable('favorites');
  if (hasFav) {
    await knex.schema.createTable('favorites_old', (table) => {
      table.increments('id').primary();
      table.string('wallet_address', 255).notNullable().unique();
      table.text('favorites').notNullable().defaultTo('[]');
      table.timestamp('updated_at').defaultTo(knex.fn.now());
    });

    await knex.raw(`
      INSERT OR IGNORE INTO favorites_old (id, wallet_address, favorites, updated_at)
      SELECT id, wallet_address, favorites, updated_at FROM favorites
    `).catch(() => {
      // PostgreSQL uses ON CONFLICT instead
      return knex.raw(`
        INSERT INTO favorites_old (id, wallet_address, favorites, updated_at)
        SELECT id, wallet_address, favorites, updated_at FROM favorites
        ON CONFLICT DO NOTHING
      `);
    });

    await knex.schema.dropTable('favorites');
    await knex.schema.renameTable('favorites_old', 'favorites');
  }

  // Rebuild popular_searches without tenant_id
  const hasPop = await knex.schema.hasTable('popular_searches');
  if (hasPop) {
    await knex.schema.createTable('popular_searches_old', (table) => {
      table.string('query', 1000).primary();
      table.integer('search_count').defaultTo(1);
      table.timestamp('last_updated').defaultTo(knex.fn.now());
    });

    await knex.raw(`
      INSERT OR IGNORE INTO popular_searches_old (query, search_count, last_updated)
      SELECT query, search_count, last_updated FROM popular_searches
    `).catch(() => {
      return knex.raw(`
        INSERT INTO popular_searches_old (query, search_count, last_updated)
        SELECT query, search_count, last_updated FROM popular_searches
        ON CONFLICT DO NOTHING
      `);
    });

    await knex.schema.dropTable('popular_searches');
    await knex.schema.renameTable('popular_searches_old', 'popular_searches');
  }
}
