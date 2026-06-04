# Price Feed Aggregator

A production-ready Soroban smart contract that aggregates prices from multiple on-chain reporters into a single tamper-resistant value for a given asset pair (e.g. `XLM/USD`).

## How It Works

Each registered **source** has a designated reporter address. Reporters submit prices independently. When `get_aggregated_price` is called, the contract:

1. Collects all **active** sources whose price is **not stale** (within `max_price_age` seconds).
2. Applies **outlier detection** — filters sources whose price deviates more than `outlier_bps` basis points from the current median (when > 2 sources are available).
3. Computes the final price using the configured **aggregation strategy**.

## Aggregation Strategies

| Strategy | Description | Best for |
|---|---|---|
| `Median` (default) | Middle value of sorted prices | Robust against manipulation |
| `WeightedAverage` | Σ(price × weight) / Σ(weight) | Trusted sources with different reliability |
| `TrimmedMean` | Average after dropping top/bottom `trim_pct` % | Large source sets |

## Security Features

| Feature | Parameter | Default |
|---|---|---|
| Circuit breaker | `circuit_breaker_bps` | 3000 bps (30%) — rejects single-update swings above this |
| Outlier detection | `outlier_bps` | 2000 bps (20%) — excludes sources far from the median |
| Stale price exclusion | `max_price_age` | 3600 s (1 hour) |
| Emergency pause | admin-only | — |
| Reporter auth | per-source | Only the registered reporter may update a source |

## Contract Functions

### Admin

| Function | Description |
|---|---|
| `initialize(admin, asset, decimals?, max_price_age?, outlier_bps?, circuit_breaker_bps?, strategy?)` | One-time setup |
| `pause(admin)` / `unpause(admin)` | Emergency controls |
| `add_source(admin, reporter, description, weight?)` | Register a new price source |
| `remove_source(admin, source_id)` | Deactivate a source |
| `set_weight(admin, source_id, weight)` | Update source weight (1–100) |
| `set_strategy(admin, strategy)` | Change aggregation strategy |
| `set_max_price_age(admin, max_age)` | Update staleness threshold |
| `set_outlier_bps(admin, bps)` | Update outlier threshold |
| `set_circuit_breaker_bps(admin, bps)` | Update circuit breaker threshold |

### Reporter

| Function | Description |
|---|---|
| `update_price(reporter, source_id, price)` | Submit a new price (must be the registered reporter) |

### Read-only

| Function | Description |
|---|---|
| `get_price(source_id)` | Raw price data for a single source |
| `get_aggregated_price()` | Aggregated price across all valid sources |
| `get_source_count()` | Total number of sources ever registered |
| `get_admin()` | Admin address |
| `is_paused()` | Pause state |

## Events

| Event | Payload |
|---|---|
| `init` | `(admin, asset)` |
| `paused` / `unpaused` | `admin` |
| `srcadd` | `(source_id, reporter)` |
| `srcrm` | `source_id` |
| `priceupd` | `(source_id, price)` |

## Building

```bash
cd contracts/price-feed-aggregator
cargo build --target wasm32-unknown-unknown --release
```

## Testing

```bash
cd contracts/price-feed-aggregator
cargo test
```

## Deploying to Testnet

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Deploy
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/price_feed_aggregator.wasm \
  --source <YOUR_ACCOUNT> \
  --network testnet

# Initialize (replace CONTRACT_ID, ADMIN_ADDRESS)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <YOUR_ACCOUNT> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --asset "XLM/USD"

# Add a source
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network testnet \
  -- add_source \
  --admin <ADMIN_ADDRESS> \
  --reporter <REPORTER_ADDRESS> \
  --description "Binance XLM/USD" \
  --weight 1

# Submit a price (price scaled by decimals, default 10^7)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <REPORTER_ACCOUNT> \
  --network testnet \
  -- update_price \
  --reporter <REPORTER_ADDRESS> \
  --source_id 0 \
  --price 1234567  # = $0.1234567

# Read aggregated price
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ANY_ACCOUNT> \
  --network testnet \
  -- get_aggregated_price
```

## Price Scaling

Prices are integer values scaled by `10^decimals` (default `decimals = 7`). For example:

| Human price | On-chain value |
|---|---|
| $0.10 | `1_000_000` |
| $1.00 | `10_000_000` |
| $123.45 | `1_234_500_000` |

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 1 | `AlreadyInitialized` | `initialize` called more than once |
| 2 | `NotInitialized` | Contract not yet initialized |
| 3 | `Unauthorized` | Caller is not the admin or registered reporter |
| 4 | `SourceNotFound` | Source ID does not exist |
| 5 | `SourceInactive` | Source has been deactivated |
| 6 | `InvalidPrice` | Price ≤ 0 |
| 7 | `StalePrice` | (reserved) |
| 8 | `InsufficientSources` | No valid active sources for aggregation |
| 9 | `ContractPaused` | Operation blocked while paused |
| 10 | `InvalidWeight` | Weight outside 1–100 range |
| 11 | `OutlierDetected` | (reserved) |
| 12 | `CircuitBreakerTripped` | Price update exceeds `circuit_breaker_bps` swing |
| 13 | `InvalidParameter` | Config value out of valid range |
