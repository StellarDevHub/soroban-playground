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

## Docker / production image

The `Dockerfile` is a hardened multi-stage build:

- **`deps` stage** installs production dependencies only (`npm ci --omit=dev`).
  Native modules (`sqlite3`) are compiled here, so the build toolchain never
  ships in the final image.
- **`runtime` stage** is a patched `node:20-alpine` that runs as the non-root
  `node` user, sets `NODE_ENV=production`, copies only the production
  `node_modules` + `src` + `migrations` (tests/configs/dev tooling are excluded
  via `.dockerignore`), uses `tini` as PID 1, and ships a `/api/health`
  healthcheck.

```bash
docker build -t soroban-backend ./backend
docker run --rm -p 5000:5000 soroban-backend
```

### Read-only filesystem

The container can run with a read-only root filesystem; the compiler and logs
need writable scratch space, mounted as tmpfs:

```bash
docker run --rm -p 5000:5000 \
  --read-only \
  --tmpfs /tmp \
  --tmpfs /app/cache \
  --tmpfs /app/logs \
  soroban-backend
```

### Why not Distroless / <150MB

The API compiles Soroban contracts **in-process** — `compileWorker` spawns
`cargo build` at request time. The runtime therefore must contain the Rust
toolchain (`rustc`/`cargo`/`wasm32-unknown-unknown`), which is several hundred
MB and requires a shell. Google Distroless (no shell, no toolchain) and a
`<150MB` image are fundamentally incompatible with that requirement. The image
instead targets the achievable security posture: multi-stage build, no dev
dependencies in the final layer, non-root execution, a patched Alpine base, and
a read-only-fs run mode. Splitting compilation into a separate worker service
would be the path to a Distroless API container, but that is out of scope here.
