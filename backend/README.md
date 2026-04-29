# Backend API

## Compile

- URL: `POST /api/compile`
- Body:

```json
{
  "code": "<Rust source for src/lib.rs>",
  "dependencies": {
    "serde": "1.0",
    "serde_json": "^1.0"
  }
}
```

- Notes:
  - `dependencies` is optional. When present, items are injected under the `[dependencies]` section of `Cargo.toml`.
  - `soroban-sdk` is pinned by the backend and cannot be overridden.

- Validation:
  - Crate names: lowercase `[a-z0-9][a-z0-9_-]{0,63}`.
  - Versions: only characters `[0-9A-Za-zxX.^~* <>=,+-]` and spaces; max length 50.
  - Max dependencies: 20.
  - Disallows quotes, brackets, or newlines in names/versions.

- Errors:
  - `400` when code is missing or dependency input is invalid (details included).
  - `400` when dependency payload cannot be safely transformed into `Cargo.toml`.
  - `500` on compilation failures (stderr/diagnostics included).

## Cache Administration

The backend now includes a multi-level compile cache with:
- L1 in-memory cache for hot compile artifacts
- L2 Redis cache for shared cache persistence and faster cold-start hits
- L3 filesystem fallback for persisted WASM artifacts
- Cache versioning, dependency-based invalidation, stampede prevention, and predictive warmers

Admin cache endpoints:
- `GET /api/admin/cache` — current cache state, version, hit/miss counters, Redis health
- `POST /api/admin/cache/warm` — proactively warm cache for a list of hashes or top predictors
- `POST /api/admin/cache/invalidate` — invalidate by hash, dependency, or bump namespace version
- `GET /api/admin/cache/keys` — list matching Redis cache keys
- `POST /api/admin/cache/version/bump` — atomically bump the cache namespace version

## Airdrop (Merkle)

Endpoints:
- `GET /api/airdrop/config` — returns the Merkle root, token metadata, and allocation summary
- `POST /api/airdrop/eligibility` — returns eligibility status and proof for a wallet
- `POST /api/airdrop/claim` — validates a proof and returns a claim payload for on-chain submission

## Database Migrations

This backend supports file-based SQL migrations with rollback support and metadata tracking.

Migration conventions:
- Migration files live in `backend/migrations` by default
- Each migration version requires both:
  - `V###__name.up.sql`
  - `V###__name.down.sql`
- `BEGIN`, `COMMIT`, and `ROLLBACK` are not allowed in migration SQL; the runner manages transaction boundaries
- Up and down SQL are checksummed to detect modified applied migrations

Admin migration endpoints:
- `GET /api/admin/migrations` — migration dashboard showing available and applied migrations
- `POST /api/admin/migrations/validate` — validates pairs, checksums, and forbidden transaction statements
- `POST /api/admin/migrations/apply` — apply a given version or all pending migrations
- `POST /api/admin/migrations/rollback` — rollback a given migration version

Migration options:
- `dryRun` — validate SQL without persisting schema changes
- `allowDestructive` — permit operations flagged as potentially destructive

## Global Error Handling

- All backend routes use a shared error middleware and return a consistent error shape:

```json
{
  "message": "Validation failed",
  "statusCode": 400,
  "details": ["code is required"]
}
```

- Notes:
  - `details` is optional and primarily included for validation/client-actionable errors.
  - Unknown errors default to `500` with a safe fallback.
  - In production, internal `500` details are hidden to avoid leaking sensitive internals.
  - Unknown routes return a structured `404` response using the same format.
