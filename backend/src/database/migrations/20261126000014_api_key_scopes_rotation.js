const DEFAULT_SCOPES = JSON.stringify([
  'contracts:read',
  'contracts:compile',
  'contracts:deploy',
]);

export async function up(knex) {
  if (!(await knex.schema.hasTable('api_keys'))) return;

  const hasScopes = await knex.schema.hasColumn('api_keys', 'scopes');
  const hasRotationGroupId = await knex.schema.hasColumn(
    'api_keys',
    'rotation_group_id'
  );
  const hasRotationRole = await knex.schema.hasColumn(
    'api_keys',
    'rotation_role'
  );
  const hasReplacesKeyId = await knex.schema.hasColumn(
    'api_keys',
    'replaces_key_id'
  );
  const hasRotationCutoffAt = await knex.schema.hasColumn(
    'api_keys',
    'rotation_cutoff_at'
  );

  await knex.schema.alterTable('api_keys', (table) => {
    if (!hasScopes) {
      table.text('scopes').notNullable().defaultTo(DEFAULT_SCOPES);
    }
    if (!hasRotationGroupId) {
      table.string('rotation_group_id', 64).nullable();
    }
    if (!hasRotationRole) {
      table.string('rotation_role', 32).notNullable().defaultTo('standalone');
    }
    if (!hasReplacesKeyId) {
      table.integer('replaces_key_id').nullable();
    }
    if (!hasRotationCutoffAt) {
      table.timestamp('rotation_cutoff_at').nullable();
    }
  });

  await knex('api_keys').whereNull('scopes').update({ scopes: DEFAULT_SCOPES });
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS idx_api_keys_rotation_group ON api_keys (rotation_group_id, status)'
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_api_keys_rotation_group');

  if (
    knex.client.dialect !== 'postgresql' ||
    !(await knex.schema.hasTable('api_keys'))
  ) {
    return;
  }

  await knex.schema.alterTable('api_keys', (table) => {
    table.dropColumn('rotation_cutoff_at');
    table.dropColumn('replaces_key_id');
    table.dropColumn('rotation_role');
    table.dropColumn('rotation_group_id');
    table.dropColumn('scopes');
  });
}
