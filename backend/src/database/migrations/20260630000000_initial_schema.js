/**
 * Initial schema migration using dialect-agnostic Knex schema builder.
 *
 * Replaces raw SQLite-only schema.sql execution so that migrations run cleanly
 * on both SQLite (local development / CI) and PostgreSQL (production / CI):
 *  - AUTOINCREMENT / SERIAL -> table.increments('id').primary()
 *  - DATETIME -> table.timestamp(..., { useTz: true }) (TIMESTAMPTZ on PG)
 *  - BLOB -> table.binary(...) (BYTEA on PG)
 *  - INSERT OR IGNORE -> onConflict().ignore()
 *  - FTS5 virtual table & triggers -> SQLite-only guard
 */

export async function up(knex) {
  const client = knex.client?.config?.client || 'sqlite3';
  const isSqlite = client === 'sqlite3' || client === 'better-sqlite3';

  // 1. Users
  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.text('username').notNullable().unique();
      table.text('email').notNullable().unique();
      table.text('password_hash').notNullable();
      table.text('role').notNullable().defaultTo('user');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  // 2. Roles & Permissions
  if (!(await knex.schema.hasTable('roles'))) {
    await knex.schema.createTable('roles', (table) => {
      table.increments('id').primary();
      table.text('name').notNullable().unique();
      table.text('description').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('permissions'))) {
    await knex.schema.createTable('permissions', (table) => {
      table.increments('id').primary();
      table.text('name').notNullable().unique();
      table.text('description').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('role_permissions'))) {
    await knex.schema.createTable('role_permissions', (table) => {
      table
        .integer('role_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('roles')
        .onDelete('CASCADE');
      table
        .integer('permission_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('permissions')
        .onDelete('CASCADE');
      table.primary(['role_id', 'permission_id']);
    });
  }

  // Seed default roles & permissions
  await knex('roles')
    .insert([
      { name: 'admin', description: 'Administrator with full access' },
      { name: 'developer', description: 'Developer who can manage own projects' },
      { name: 'guest', description: 'Guest user with read-only access' },
    ])
    .onConflict('name')
    .ignore();

  await knex('permissions')
    .insert([
      { name: 'project:create', description: 'Create new projects' },
      { name: 'project:read', description: 'Read own projects' },
      { name: 'project:update', description: 'Update own projects' },
      { name: 'project:delete', description: 'Delete own projects' },
      { name: 'project:read_all', description: 'Read all projects (admin)' },
      {
        name: 'project:write_all',
        description: 'Modify/Delete all projects (admin)',
      },
    ])
    .onConflict('name')
    .ignore();

  // 3. Templates (must exist before files references it)
  if (!(await knex.schema.hasTable('templates'))) {
    await knex.schema.createTable('templates', (table) => {
      table.increments('id').primary();
      table.text('dir_name').notNullable().unique();
      table.text('name').notNullable();
      table.text('description').notNullable();
      table.text('category').notNullable();
      table.text('complexity').notNullable();
      table.text('deployment_status').notNullable();
      table.text('tags').nullable();
      table.text('dependencies').nullable();
      table.text('functionalities').nullable();
      table.text('features').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('category', 'idx_templates_category');
      table.index('complexity', 'idx_templates_complexity');
    });
  }

  await knex('templates')
    .insert([
      {
        dir_name: 'hello-world',
        name: 'Hello World',
        description: 'Minimal Soroban contract example',
        category: 'Utilities',
        complexity: 'Beginner',
        deployment_status: 'Testnet',
        tags: '["minimal","example"]',
        dependencies: '[]',
        functionalities: '["Basic"]',
        features: '["Simple function call"]',
      },
      {
        dir_name: 'counter',
        name: 'Counter',
        description: 'Simple counter with state management',
        category: 'Utilities',
        complexity: 'Beginner',
        deployment_status: 'Testnet',
        tags: '["state","storage"]',
        dependencies: '[]',
        functionalities: '["Basic","State Management"]',
        features: '["State persistence"]',
      },
      {
        dir_name: 'stablecoin',
        name: 'Stablecoin',
        description: 'Algorithmic stablecoin with collateral',
        category: 'DeFi',
        complexity: 'Advanced',
        deployment_status: 'Production',
        tags: '["defi","collateral"]',
        dependencies: '[{"name":"soroban-sdk","version":"^21.0"}]',
        functionalities: '["Token Operations","Advanced"]',
        features: '["Minting","Burning","Price feed"]',
      },
    ])
    .onConflict('dir_name')
    .ignore();

  // 4. Projects
  if (!(await knex.schema.hasTable('projects'))) {
    await knex.schema.createTable('projects', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.text('title').notNullable();
      table.text('description').notNullable();
      table.text('category').notNullable();
      table
        .enu('status', ['draft', 'active', 'funded', 'completed', 'cancelled'], {
          useNative: false,
        })
        .notNullable();
      table.integer('creator_id').notNullable();
      table.text('creator_name').notNullable();
      table.float('funding_goal').notNullable();
      table.float('current_funding').defaultTo(0);
      table.float('completion_rate').defaultTo(0);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.text('tags').nullable();
      table.text('metadata').nullable();

      table.index('category', 'idx_projects_category');
      table.index('status', 'idx_projects_status');
      table.index('creator_id', 'idx_projects_creator');
      table.index('tenant_id', 'idx_projects_tenant');
      table.index('current_funding', 'idx_projects_funding');
      table.index('created_at', 'idx_projects_created');
      table.index('completion_rate', 'idx_projects_completion');
    });
  }

  // FTS5 virtual table is SQLite-only
  if (isSqlite) {
    await knex.raw(`
      CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(
        title UNINDEXED,
        description,
        category,
        creator_name,
        tags,
        content='projects',
        content_rowid='id',
        tokenize='porter unicode61 remove_diacritics 1'
      )
    `);
  }

  // 5. Files
  if (!(await knex.schema.hasTable('files'))) {
    await knex.schema.createTable('files', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table
        .integer('project_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('projects');
      table
        .integer('template_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('templates');
      table
        .integer('uploader_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('users');
      table.text('filename').notNullable();
      table.text('filepath').notNullable();
      table.text('mimetype').notNullable();
      table.integer('size_bytes').notNullable();
      table.binary('content').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('tenant_id', 'idx_files_tenant');
      table.index('template_id', 'idx_files_template_id');
    });
  }

  // 6. Search tables
  if (!(await knex.schema.hasTable('search_analytics'))) {
    await knex.schema.createTable('search_analytics', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.text('query').notNullable();
      table.text('filters_applied').nullable();
      table.integer('results_count').notNullable();
      table.integer('response_time_ms').notNullable();
      table.timestamp('timestamp', { useTz: true }).defaultTo(knex.fn.now());
      table.text('user_agent').nullable();
      table.text('ip_address').nullable();

      table.index(
        ['tenant_id', 'timestamp'],
        'idx_search_analytics_tenant_timestamp'
      );
      table.index('timestamp', 'idx_search_analytics_timestamp');
    });
  }

  if (!(await knex.schema.hasTable('search_suggestions'))) {
    await knex.schema.createTable('search_suggestions', (table) => {
      table.increments('id').primary();
      table.text('suggestion').notNullable().unique();
      table.integer('frequency').defaultTo(1);
      table.timestamp('last_used', { useTz: true }).defaultTo(knex.fn.now());

      table.index('frequency', 'idx_search_suggestions_freq');
    });
  }

  if (!(await knex.schema.hasTable('popular_searches'))) {
    await knex.schema.createTable('popular_searches', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.text('query').notNullable();
      table.integer('search_count').defaultTo(1);
      table.timestamp('last_updated', { useTz: true }).defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'query']);

      table.index(
        ['tenant_id', 'search_count'],
        'idx_popular_searches_tenant_count'
      );
    });
  }

  // 7. Organizations & API keys & Rate limiting
  if (!(await knex.schema.hasTable('organizations'))) {
    await knex.schema.createTable('organizations', (table) => {
      table.increments('id').primary();
      table.text('name').notNullable().unique();
      table.text('description').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('api_keys'))) {
    await knex.schema.createTable('api_keys', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.text('key_hash').notNullable().unique();
      table.text('key_prefix').notNullable();
      table.text('name').notNullable();
      table.text('description').nullable();
      table
        .enu('tier', ['free', 'standard', 'premium', 'admin'], {
          useNative: false,
        })
        .notNullable();
      table
        .enu('status', ['active', 'revoked', 'expired'], { useNative: false })
        .notNullable()
        .defaultTo('active');
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users');
      table
        .integer('organization_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('organizations');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('expires_at', { useTz: true }).nullable();
      table.timestamp('last_used_at', { useTz: true }).nullable();
      table.integer('usage_count').defaultTo(0);

      table.index('key_prefix', 'idx_api_keys_key_prefix');
      table.index('tenant_id', 'idx_api_keys_tenant_id');
      table.index('user_id', 'idx_api_keys_user_id');
      table.index('status', 'idx_api_keys_status');
    });
  }

  if (!(await knex.schema.hasTable('rate_limit_usage'))) {
    await knex.schema.createTable('rate_limit_usage', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table
        .integer('api_key_id')
        .unsigned()
        .notNullable()
        .references('id')
        .inTable('api_keys');
      table.text('endpoint').notNullable();
      table.integer('request_count').notNullable().defaultTo(1);
      table.timestamp('window_start', { useTz: true }).notNullable();
      table.timestamp('window_end', { useTz: true }).notNullable();
      table.text('tier').notNullable();

      table.index(
        ['tenant_id', 'window_start', 'window_end'],
        'idx_rate_limit_usage_tenant_window'
      );
      table.index(
        ['api_key_id', 'window_start', 'window_end'],
        'idx_rate_limit_usage_api_key_window'
      );
      table.unique(['api_key_id', 'endpoint', 'window_start', 'window_end'], {
        indexName: 'idx_rate_limit_usage_unique',
      });
    });
  }

  if (!(await knex.schema.hasTable('tier_limits'))) {
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
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  await knex('tier_limits')
    .insert([
      {
        tier: 'free',
        requests_per_minute: 10,
        requests_per_hour: 100,
        requests_per_day: 1000,
        burst_limit: 20,
      },
      {
        tier: 'standard',
        requests_per_minute: 100,
        requests_per_hour: 1000,
        requests_per_day: 10000,
        burst_limit: 200,
      },
      {
        tier: 'premium',
        requests_per_minute: 1000,
        requests_per_hour: 10000,
        requests_per_day: 100000,
        burst_limit: 2000,
      },
      {
        tier: 'admin',
        requests_per_minute: 10000,
        requests_per_hour: 100000,
        requests_per_day: 1000000,
        burst_limit: 20000,
      },
    ])
    .onConflict('tier')
    .ignore();

  if (!(await knex.schema.hasTable('audit_log'))) {
    await knex.schema.createTable('audit_log', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table
        .integer('api_key_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('api_keys');
      table
        .integer('user_id')
        .unsigned()
        .nullable()
        .references('id')
        .inTable('users');
      table.text('action').notNullable();
      table.text('endpoint').nullable();
      table.text('ip_address').nullable();
      table.text('user_agent').nullable();
      table.integer('status_code').nullable();
      table.integer('response_time_ms').nullable();
      table.timestamp('timestamp', { useTz: true }).defaultTo(knex.fn.now());
      table.text('metadata').nullable();

      table.index(['tenant_id', 'timestamp'], 'idx_audit_log_tenant_timestamp');
      table.index(
        ['api_key_id', 'timestamp'],
        'idx_audit_log_api_key_timestamp'
      );
      table.index('timestamp', 'idx_audit_log_timestamp');
    });
  }

  // 8. DAO Treasury Tables
  if (!(await knex.schema.hasTable('treasury_proposals'))) {
    await knex.schema.createTable('treasury_proposals', (table) => {
      table.increments('id').primary();
      table.integer('contract_tx_id').notNullable().unique();
      table.text('proposer').notNullable();
      table.text('description').notNullable();
      table.float('amount').notNullable();
      table.text('recipient').nullable();
      table
        .enu('status', ['Pending', 'Queued', 'Executed', 'Cancelled', 'Expired'], {
          useNative: false,
        })
        .notNullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('execute_after', { useTz: true }).notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();

      table.index('status', 'idx_treasury_proposals_status');
      table.index('expires_at', 'idx_treasury_proposals_expires_at');
      table.index('execute_after', 'idx_treasury_proposals_execute_after');
    });
  }

  if (!(await knex.schema.hasTable('treasury_approvals'))) {
    await knex.schema.createTable('treasury_approvals', (table) => {
      table.increments('id').primary();
      table
        .integer('proposal_id')
        .notNullable()
        .references('contract_tx_id')
        .inTable('treasury_proposals');
      table.text('signer').notNullable();
      table.timestamp('timestamp', { useTz: true }).defaultTo(knex.fn.now());

      table.index('proposal_id', 'idx_treasury_approvals_proposal_id');
    });
  }

  if (!(await knex.schema.hasTable('treasury_history'))) {
    await knex.schema.createTable('treasury_history', (table) => {
      table.increments('id').primary();
      table.text('event_type').notNullable();
      table.text('data').notNullable();
      table.timestamp('timestamp', { useTz: true }).defaultTo(knex.fn.now());

      table.index('event_type', 'idx_treasury_history_event_type');
    });
  }

  // 9. Favorites & Workspace Snapshots
  if (!(await knex.schema.hasTable('favorites'))) {
    await knex.schema.createTable('favorites', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.text('wallet_address').notNullable();
      table.text('favorites').notNullable().defaultTo('[]');
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'wallet_address']);
    });
  }

  if (!(await knex.schema.hasTable('workspace_snapshots'))) {
    await knex.schema.createTable('workspace_snapshots', (table) => {
      table.increments('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.text('wallet_address').notNullable();
      table.text('favorites').notNullable().defaultTo('[]');
      table.text('history').notNullable().defaultTo('[]');
      table.text('workspace').notNullable().defaultTo('{}');
      table.text('device_id').nullable();
      table.integer('revision').notNullable().defaultTo(0);
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'wallet_address']);

      table.index('updated_at', 'idx_workspace_snapshots_updated_at');
    });
  }

  // 10. Feature Flags & Cohorts
  if (!(await knex.schema.hasTable('feature_flags'))) {
    await knex.schema.createTable('feature_flags', (table) => {
      table.increments('id').primary();
      table.text('key').notNullable().unique();
      table.integer('enabled').notNullable().defaultTo(0);
      table.float('rollout_pct').notNullable().defaultTo(0);
      table.text('description').notNullable().defaultTo('');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('enabled', 'idx_feature_flags_enabled');
    });
  }

  if (!(await knex.schema.hasTable('flag_cohorts'))) {
    await knex.schema.createTable('flag_cohorts', (table) => {
      table.increments('id').primary();
      table
        .text('flag_key')
        .notNullable()
        .references('key')
        .inTable('feature_flags')
        .onDelete('CASCADE');
      table.text('cohort_id').notNullable();
      table.integer('enabled').notNullable().defaultTo(1);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.unique(['flag_key', 'cohort_id']);

      table.index('flag_key', 'idx_flag_cohorts_flag_key');
      table.index('cohort_id', 'idx_flag_cohorts_cohort_id');
    });
  }

  // 11. CORS Whitelist & Webhooks
  if (!(await knex.schema.hasTable('cors_whitelist'))) {
    await knex.schema.createTable('cors_whitelist', (table) => {
      table.increments('id').primary();
      table.text('origin').notNullable().unique();
      table.integer('active').notNullable().defaultTo(1);
      table.text('added_by').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('webhook_subscriptions'))) {
    await knex.schema.createTable('webhook_subscriptions', (table) => {
      table.text('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table.text('url').notNullable();
      table.text('events').notNullable().defaultTo('[]');
      table.text('secret').notNullable();
      table.integer('active').notNullable().defaultTo(1);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index(
        ['tenant_id', 'active'],
        'idx_webhook_subscriptions_tenant_active'
      );
    });
  }

  if (!(await knex.schema.hasTable('webhook_deliveries'))) {
    await knex.schema.createTable('webhook_deliveries', (table) => {
      table.text('id').primary();
      table.text('tenant_id').notNullable().defaultTo('public');
      table
        .text('subscription_id')
        .notNullable()
        .references('id')
        .inTable('webhook_subscriptions')
        .onDelete('CASCADE');
      table.text('event_type').notNullable();
      table.text('payload').notNullable();
      table
        .enu('status', ['pending', 'success', 'failed', 'retrying'], {
          useNative: false,
        })
        .notNullable()
        .defaultTo('pending');
      table.integer('attempt').notNullable().defaultTo(0);
      table
        .timestamp('next_attempt_at', { useTz: true })
        .defaultTo(knex.fn.now());
      table.integer('response_status').nullable();
      table.text('response_body').nullable();
      table.timestamp('delivered_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index(
        ['status', 'next_attempt_at'],
        'idx_webhook_deliveries_status_next'
      );
      table.index(
        ['tenant_id', 'created_at'],
        'idx_webhook_deliveries_tenant_created'
      );
    });
  }

  // 12. Offline Sync Logs
  if (!(await knex.schema.hasTable('sync_logs'))) {
    await knex.schema.createTable('sync_logs', (table) => {
      table.increments('id').primary();
      table.text('table_name').notNullable();
      table.text('record_id').notNullable();
      table
        .enu('operation', ['insert', 'update', 'delete'], { useNative: false })
        .notNullable();
      table.text('payload').notNullable().defaultTo('{}');
      table.timestamp('client_timestamp', { useTz: true }).notNullable();
      table
        .enu('status', ['pending', 'applied', 'conflict', 'error'], {
          useNative: false,
        })
        .notNullable()
        .defaultTo('pending');
      table.text('error_message').nullable();
      table.timestamp('synced_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index(['table_name', 'record_id'], 'idx_sync_logs_table_record');
      table.index('status', 'idx_sync_logs_status');
      table.index('client_timestamp', 'idx_sync_logs_client_timestamp');
    });
  }
}

export async function down(knex) {
  const tables = [
    'sync_logs',
    'webhook_deliveries',
    'webhook_subscriptions',
    'cors_whitelist',
    'flag_cohorts',
    'feature_flags',
    'workspace_snapshots',
    'favorites',
    'treasury_history',
    'treasury_approvals',
    'treasury_proposals',
    'audit_log',
    'tier_limits',
    'rate_limit_usage',
    'api_keys',
    'organizations',
    'popular_searches',
    'search_suggestions',
    'search_analytics',
    'files',
    'projects_fts',
    'projects',
    'templates',
    'role_permissions',
    'permissions',
    'roles',
    'users',
  ];

  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
