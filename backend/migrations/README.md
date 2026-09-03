# Legacy Raw SQL Migrations

> **These files are NOT used by Knex and are kept for historical reference only.**
>
> The active Knex migration files live in
> `backend/src/database/migrations/*.js`.

---

## Background

Before the Knex migration system was established, this directory held raw SQL
migration pairs in Flyway-style naming (`V001__name.up.sql` / `.down.sql`).
They were never executed by Knex and are not part of any automated pipeline.

The raw SQL has been ported to dialect-agnostic Knex migration files that work
with both **SQLite** (development/test) and **PostgreSQL** (production).

## Mapping: raw SQL → Knex migration

| Raw SQL file                                | Knex migration file                                                    |
|---------------------------------------------|------------------------------------------------------------------------|
| `V001__create_users_table.{up,down}.sql`    | `20260701000001_create_users_table.js`                                 |
| `V002__add_rate_limiting.{up,down}.sql`     | `20260701000002_add_rate_limiting.js`                                  |
| `V003__synthetic_assets.{up,down}.sql`      | `20260701000003_synthetic_assets.js` (PG-specific SQL converted)       |
| `V004__add_webhooks_and_cors_whitelist.*`   | `20260701000004_add_webhooks_and_cors_whitelist.js`                    |
| `V004__contract_events.{up,down}.sql`       | `20260701000005_contract_events.js` (duplicate version resolved)       |
| `V005__zero_downtime_helpers.{up,down}.sql` | `20260701000006_zero_downtime_helpers.js`                              |
| `V006__multi_tenant_isolation.{up,down}.sql`| `20260701000007_multi_tenant_isolation.js`                             |
| `V007__contract_verification.{up,down}.sql` | `20260701000008_contract_verification.js`                              |
| `001_initial_schema.{up,down}.sql`          | `20260630000000_initial_schema.js` (reads `schema.sql`)                |

## Why Knex instead of raw SQL?

- **Dialect safety** — Knex schema builder generates correct SQL for SQLite and
  PostgreSQL without manual `IF` branches.
- **Reversibility** — every `.js` migration has both `up()` and `down()` hooks.
- **Tooling** — `knex migrate:latest`, `knex migrate:rollback`, and
  `knex migrate:status` work out of the box.
- **CI integration** — the test suite in `backend/tests/knexMigrations.test.js`
  runs all migrations on an in-memory SQLite database to catch regressions.

## Running migrations

```bash
# Apply all pending migrations (SQLite in development)
cd backend
npx knex migrate:latest

# Apply with PostgreSQL
DATABASE_CLIENT=pg DATABASE_URL=postgres://... npx knex migrate:latest

# Roll back one step
npx knex migrate:rollback

# Check status
npx knex migrate:status
```

## Indexer migrations

The `indexer/migrations/postgres/` directory contains **separate** DDL managed
by the Rust/sqlx indexer.  See that directory's `README.md` for details.
