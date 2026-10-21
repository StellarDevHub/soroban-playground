/**
 * Run `fn(trx)` in a transaction scoped to one tenant.
 * Postgres: drops to the non-owner role so RLS applies, and sets the session
 * variables transaction-locally (set_config(..., true) == SET LOCAL, but takes
 * bind parameters). Other databases have no RLS, so this is a plain transaction.
 */
export async function withTenant(knex, { userId, tenantId } = {}, fn) {
  if (knex.client.dialect !== 'postgresql') return knex.transaction(fn);

  return knex.transaction(async (trx) => {
    await trx.raw('SET LOCAL ROLE app_tenant');
    await trx.raw("SELECT set_config('app.current_user_id', ?, true)", [
      userId == null ? '' : String(userId),
    ]);
    await trx.raw("SELECT set_config('app.current_tenant_id', ?, true)", [
      tenantId == null ? '' : String(tenantId),
    ]);
    return fn(trx);
  });
}
