const RLS_TABLES = ['projects', 'api_keys', 'audit_log'];

export async function up(knex) {
  if (knex.client.dialect !== 'postgresql') return;

  await knex.raw(`
    CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS text
    LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        NULLIF(current_setting('app.current_tenant_id', true), ''),
        'user:' || NULLIF(current_setting('app.current_user_id', true), '')
      )
    $$;
  `);

  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
        CREATE ROLE app_tenant NOLOGIN;
      END IF;
    END $$;
  `);

  for (const t of RLS_TABLES) {
    if (!(await knex.schema.hasTable(t))) continue;
    await knex.raw(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`);
    await knex.raw(`
      CREATE POLICY tenant_isolation ON ${t}
        USING (tenant_id = app_current_tenant())
        WITH CHECK (tenant_id = app_current_tenant())
    `);
    await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO app_tenant`);
  }
  await knex.raw(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO app_tenant`);
}

export async function down(knex) {
  if (knex.client.dialect !== 'postgresql') return;
  for (const t of RLS_TABLES) {
    if (!(await knex.schema.hasTable(t))) continue;
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON ${t}`);
    await knex.raw(`ALTER TABLE ${t} DISABLE ROW LEVEL SECURITY`);
  }
  await knex.raw(`DROP FUNCTION IF EXISTS app_current_tenant()`);
}
