# Price Aggregator

Multi-asset Soroban oracle aggregator with authenticated reporter binding, per-asset bounds, median consensus, and aggregate swing protection.

## Configuration and use

1. `initialize(admin, strategy?, max_price_age?, outlier_bps?, circuit_breaker_bps?, min_sources?)` initializes once. Only `Median` is accepted. Heartbeat must be 1 to 3,600 seconds; source minimum must be 3 to 32 (default three); basis-point thresholds must be 1 to 10,000.
2. Admin calls `add_source(admin, name, weight)` to allocate a source ID, then **`set_reporter(admin, source_id, reporter)`** to bind its signing address. Unbound IDs cannot submit or contribute prices. Binding is immutable and duplicate active reporter addresses are rejected. To rotate a reporter, remove the old source and register/bind a new ID.
3. Admin calls **`set_price_bounds(admin, asset, min, max)`** separately for every asset, using positive inclusive limits in its 18-decimal price scale (human price multiplied by 10^18). There is no default band.
4. The bound reporter calls `update_price(source_addr, source_id, asset, price)`. Signing with an unrelated address does not authorize submission under an existing source ID.
5. Consumers call `get_aggregated_price(asset)`. `get_price(source_id, asset)` provides validated individual-source data.

The default outlier tolerance is 20%. An aggregate deviating more than 50% from the last accepted aggregate is rejected by the existing relative circuit breaker. Failed reads do not overwrite that accepted baseline. Admin can pause/unpause, remove sources, and update weight metadata. `get_source`, `get_source_count`, `get_admin`, `get_strategy`, and `is_paused` expose metadata. The existing 32-source limit remains.

## Compatibility and existing deployments

Existing entry-point signatures and source metadata remain unchanged. Integrations must add reporter binding and per-asset bounds configuration before submitting prices; backend/UI consumers using the previous registration flow need to invoke these new admin entry points.

Pre-binding `DataKey::Price` records are **not trusted**: older code did not bind source IDs to signing addresses. Authenticated submissions now use `DataKey::VerifiedPrice`, so every source must publish fresh rounds after the upgrade. Old records are retained but never consumed; there is no automatic migration of untrusted values.

Legacy minimum-source settings below three are clamped to three; legacy heartbeat settings above one hour are capped. Non-median configurations must be changed to `Median`. Consumers that relied on single-source consensus, weighted/trimmed aggregation, or reads while paused must update their assumptions.

## Price safety policy

- Every consumed round must be positive, inside inclusive admin-configured price bounds, and no older than the configured heartbeat. The heartbeat cannot exceed **3,600 seconds**. Exactly 3,600 seconds is valid at the default; 3,601 is stale. Future timestamps are rejected.
- Aggregation returns the **median of at least three distinct reporter addresses**, after inactive, stale, invalid, duplicate, and outlier rounds have been excluded. It fails with `InsufficientSources` if filtering removes quorum. Registering several IDs for one reporter cannot create quorum.
- `WeightedAverage` and `TrimmedMean` enum variants remain for ABI decoding, but initialization and strategy changes reject them. Legacy non-median configurations also cannot produce aggregates. Weights remain metadata and never influence the median.
- Price bounds must be explicitly configured; there is no universal default band appropriate to all assets. Missing bounds fail closed with `PriceBoundsNotSet`. Invalid bounds (`min <= 0` or `max < min`) are rejected. Bounds apply to initial submissions, later updates, and previously stored rounds at read time.
- The aggregate timestamp is the **oldest valid candidate round timestamp**, conservatively including candidates later excluded as outliers. Reading repeatedly never makes an old round fresh.
- Pause blocks submissions and price reads. Single-source `get_price` validates the round but is diagnostic data, not a quorum result; financial consumers should use `get_aggregated_price`.
- Price/deviation arithmetic avoids multiplying an i128 price by 10,000 or adding two extreme prices, so valid positive prices up to `i128::MAX` do not overflow these checks.

Reporter addresses establish distinct on-chain identities, not economic independence. The administrator must select independent oracle operators and set appropriate bands for the asset and its scale. Reporters must submit current observations: timestamps record on-chain submission time and cannot prove the age of an off-chain observation.

## Existing API and Deployment Reference

The following legacy endpoints remain available. Registration alone is insufficient:
configure the bounds and reporter bindings described above before submitting prices.

## Security Features

| Feature              | Default          | Description                                                              |
| -------------------- | ---------------- | ------------------------------------------------------------------------ |
| Outlier detection    | 20% (`2000 bps`) | Prices deviating > threshold from median are excluded before aggregation |
| Circuit breaker      | 50% (`5000 bps`) | Rejects aggregate if it moves > threshold vs last accepted price         |
| Staleness check      | 3600 s           | Prices older than `max_price_age` seconds are ignored                    |
| Source authorization | Admin-controlled | Only admin-whitelisted source IDs may submit prices                      |
| Emergency pause      | Admin-controlled | Halts all price submissions in emergency                                 |

## Architecture

```
contracts/price-aggregator/       ← Soroban/Rust smart contract
backend/src/routes/priceAggregator.js         ← REST API routes
backend/src/services/priceAggregatorService.js ← Business logic + caching
frontend/src/components/PriceAggregatorDashboard.tsx ← React UI
frontend/src/app/price-aggregator/page.tsx    ← Next.js page
```

## Smart Contract

**Location:** `contracts/price-aggregator/`

### Functions

| Function                                                                                         | Access            | Description                                    |
| ------------------------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------- |
| `initialize(admin, strategy?, max_price_age?, outlier_bps?, circuit_breaker_bps?, min_sources?)` | Public (once)     | Initialize contract                            |
| `add_source(admin, name, weight)`                                                                | Admin             | Register a new price source, returns source ID |
| `set_reporter(admin, source_id, reporter)` | Admin | Bind a distinct reporter before its first submission |
| `set_price_bounds(admin, asset, min, max)` | Admin | Configure mandatory inclusive per-asset bands |
| `remove_source(admin, source_id)`                                                                | Admin             | Deactivate a source                            |
| `set_weight(admin, source_id, weight)`                                                           | Admin             | Update source weight (1–100)                   |
| `set_strategy(admin, strategy)`                                                                  | Admin             | Select Median (only supported strategy)                    |
| `update_price(source_addr, source_id, asset, price)`                                             | Authorized source | Submit a price (scaled to 10^18)               |
| `get_price(source_id, asset)`                                                                    | Read              | Get latest price from a single source          |
| `get_aggregated_price(asset)`                                                                    | Read              | Compute and return aggregated price            |
| `get_source(source_id)`                                                                          | Read              | Get source metadata                            |
| `get_source_count()`                                                                             | Read              | Total number of sources                        |
| `pause(admin)` / `unpause(admin)`                                                                | Admin             | Emergency pause                                |
| `is_paused()` / `get_admin()` / `get_strategy()`                                                 | Read              | State queries                                  |

**Events emitted:** `init`, `paused`, `unpaused`, `srcAdd`, `srcRm`, `priceUp`, `aggPrice`

### Price Scaling

All prices are submitted and stored scaled to 18 decimal places:

```
on-chain price = human_price × 10^18
```

For example, BTC at $50,000:

```
price = 50_000 × 1_000_000_000_000_000_000 = 50000000000000000000000
```

### Building

```bash
cd contracts/price-aggregator
cargo build --target wasm32-unknown-unknown --release

# Run tests
cargo test
```

### Deploying to Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/price_aggregator.wasm \
  --source <YOUR_ACCOUNT> \
  --network testnet

# Initialize
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <YOUR_ACCOUNT> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --strategy Median \
  --max_price_age 3600 \
  --outlier_bps 2000 \
  --circuit_breaker_bps 5000 \
  --min_sources 3
```

## Backend API

Base URL: `http://localhost:5000/api/price-aggregator`

| Method | Endpoint                                | Description              |
| ------ | --------------------------------------- | ------------------------ |
| POST   | `/initialize`                           | Initialize contract      |
| POST   | `/sources`                              | Add a price source       |
| DELETE | `/sources/:sourceId`                    | Remove a source          |
| PATCH  | `/sources/:sourceId/weight`             | Update source weight     |
| GET    | `/sources/:sourceId?contractId=`        | Get source info          |
| GET    | `/sources/count?contractId=`            | Get source count         |
| POST   | `/prices`                               | Submit a price update    |
| GET    | `/prices/:sourceId/:asset?contractId=`  | Get single-source price  |
| GET    | `/prices/aggregated/:asset?contractId=` | Get aggregated price     |
| POST   | `/strategy`                             | Set aggregation strategy |
| POST   | `/pause`                                | Pause contract           |
| POST   | `/unpause`                              | Unpause contract         |
| GET    | `/status?contractId=`                   | Get pause status         |

**Example: Get aggregated BTC/USD price**

```bash
curl "http://localhost:5000/api/price-aggregator/prices/aggregated/BTC%2FUSD?contractId=C..."
# Response: { "success": true, "data": { "asset": "BTC/USD", "price": "50000000000000000000000", "num_sources": 3, "strategy": "Median", ... } }
```

**Example: Submit a price**

```bash
curl -X POST http://localhost:5000/api/price-aggregator/prices \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "C...",
    "sourceAddr": "G...",
    "sourceId": 0,
    "asset": "BTC/USD",
    "price": "50000000000000000000000"
  }'
```

## Frontend

Navigate to `http://localhost:3000/price-aggregator`.

Features:

- Prices tab: query aggregated prices, submit price updates as a source
- Sources tab: view registered sources, add/remove sources (admin)
- Admin tab: change aggregation strategy, emergency pause/unpause
- WCAG 2.1 AA accessible (ARIA labels, roles, live regions)

## Environment Variables

Add to `backend/.env`:

```
# Optional: default contract ID for price aggregator
PA_CONTRACT_ID=C...
```

Add to `frontend/.env.local`:

```
NEXT_PUBLIC_PA_CONTRACT_ID=C...
```

## Running Tests

```bash
cd contracts/price-aggregator
cargo test
```

Test coverage includes:

- Initialization (success, double-init guard)
- Source management (add, remove, weight update, auth checks)
- Price submission (valid, unauthorized, inactive source, zero price)
- Staleness enforcement (stale single-source query, stale excluded from aggregation)
- Median aggregation (three-source quorum, odd/even counts)
- Rejection of non-median aggregation modes
- Insufficient sources error
- Outlier detection (outlier excluded, clean price accepted)
- Circuit breaker (trips on large swing, allows small swing)
- Multiple independent assets
- Pause enforcement

## Related

- [Synthetic Assets contract](../synthetic-assets/) — uses price feeds for collateral valuation
- [Stablecoin contract](../stablecoin/) — uses price feeds for peg maintenance
