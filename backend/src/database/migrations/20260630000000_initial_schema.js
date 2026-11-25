import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

export async function up(knex) {
  if (knex.client.dialect === 'postgresql') {
    await knex.raw("SET lock_timeout = '3s'");
  }
  const schemaPath = path.join(_dirname, '..', 'schema.sql');
  let schema = fs.readFileSync(schemaPath, 'utf8');

  if (process.env.SEED_SAMPLE_DATA === 'false') {
    schema = schema.replace(
      /-- Sample data for testing[\s\S]*?;\n\n-- DAO Treasury Tables/,
      '-- Sample data for testing skipped\n\n-- DAO Treasury Tables'
    );
  }

  const connection = await knex.client.acquireConnection();
  try {
    await new Promise((resolve, reject) => {
      connection.exec(schema, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    knex.client.releaseConnection(connection);
  }
}

export async function down(knex) {
  if (knex.client.dialect === 'postgresql') {
    await knex.raw("SET lock_timeout = '3s'");
  }
  const tables = [
    'sync_logs',
    'webhook_deliveries',
    'webhook_subscriptions',
    'cors_whitelist',
    'flag_cohorts',
    'feature_flags',
    'favorites',
    'treasury_history',
    'treasury_approvals',
    'treasury_proposals',
    'audit_log',
    'tier_limits',
    'rate_limit_usage',
    'organizations',
    'api_keys',
    'popular_searches',
    'search_suggestions',
    'search_analytics',
    'projects_fts',
    'projects',
    'files',
    'users',
  ];

  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
