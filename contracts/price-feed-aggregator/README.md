# Price Feed Aggregator

One-asset Soroban price feed with authenticated reporters, median consensus, outlier filtering, and circuit breakers.

## Configuration and use

1. `initialize(admin, asset, decimals?, max_price_age?, outlier_bps?, circuit_breaker_bps?, strategy?)` initializes once. Only `Median` is accepted. Heartbeat must be 1 to 3,600 seconds; basis-point thresholds must be 1 to 10,000.
2. Admin calls `set_price_bounds(admin, min, max)` with positive inclusive limits in the feed's price scale (default seven decimal places). For example, prices use human price multiplied by 10^7 at the default scale. Limits are asset-specific; choose them operationally rather than copying arbitrary example values.
3. Admin calls `add_source(admin, reporter, description, weight?)` for at least three independent reporters. At most 32 source IDs may be registered. Active duplicate reporters are rejected.
4. Each reporter calls `update_price(reporter, source_id, price)` under its own authorization. A change exceeding `circuit_breaker_bps` relative to that source's previous price is rejected (default 30%).
5. Consumers call `get_aggregated_price()`. `get_price(source_id)` returns validated individual-source data.

Admin may remove sources, change weight metadata, configure a stricter heartbeat with `set_max_price_age`, adjust outlier/circuit-breaker thresholds, and pause/unpause. Default outlier tolerance is 20%. Removing a source is permanent; register a new ID for replacements. `get_admin`, `get_source_count`, and `is_paused` expose configuration metadata.

## Compatibility and existing deployments

Existing entry-point signatures and source records are retained. Existing deployments must configure price bounds and select `Median` before resuming price reads. Stored heartbeat values above one hour are capped at read time, and duplicate legacy reporters are counted once. Deployments that relied on one or two sources, permissive raw reads, weighted/trimmed aggregation, or reading while paused must update their integrations.

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
configure the bounds described above before submitting prices.

## Security Features

| Feature               | Parameter             | Default                                                  |
| --------------------- | --------------------- | -------------------------------------------------------- |
| Circuit breaker       | `circuit_breaker_bps` | 3000 bps (30%) — rejects single-update swings above this |
| Outlier detection     | `outlier_bps`         | 2000 bps (20%) — excludes sources far from the median    |
| Stale price exclusion | `max_price_age`       | 3600 s (1 hour)                                          |
| Emergency pause       | admin-only            | —                                                        |
| Reporter auth         | per-source            | Only the registered reporter may update a source         |

## Contract Functions

### Admin

| Function                                                                                             | Description                      |
| ---------------------------------------------------------------------------------------------------- | -------------------------------- |
| `initialize(admin, asset, decimals?, max_price_age?, outlier_bps?, circuit_breaker_bps?, strategy?)` | One-time setup                   |
| `pause(admin)` / `unpause(admin)`                                                                    | Emergency controls               |
| `add_source(admin, reporter, description, weight?)`                                                  | Register a new price source      |
| `set_price_bounds(admin, min, max)` | Configure mandatory inclusive feed bands |
| `remove_source(admin, source_id)`                                                                    | Deactivate a source              |
| `set_weight(admin, source_id, weight)`                                                               | Update source weight (1–100)     |
| `set_strategy(admin, strategy)`                                                                      | Select Median (only supported strategy)      |
| `set_max_price_age(admin, max_age)`                                                                  | Update staleness threshold       |
| `set_outlier_bps(admin, bps)`                                                                        | Update outlier threshold         |
| `set_circuit_breaker_bps(admin, bps)`                                                                | Update circuit breaker threshold |

### Reporter

| Function                                   | Description                                          |
| ------------------------------------------ | ---------------------------------------------------- |
| `update_price(reporter, source_id, price)` | Submit a new price (must be the registered reporter) |

### Read-only

| Function                 | Description                               |
| ------------------------ | ----------------------------------------- |
| `get_price(source_id)`   | Fresh, positive, in-band data for one source        |
| `get_aggregated_price()` | Aggregated price across all valid sources |
| `get_source_count()`     | Total number of sources ever registered   |
| `get_admin()`            | Admin address                             |
| `is_paused()`            | Pause state                               |

## Events

| Event                 | Payload                 |
| --------------------- | ----------------------- |
| `init`                | `(admin, asset)`        |
| `paused` / `unpaused` | `admin`                 |
| `srcadd`              | `(source_id, reporter)` |
| `srcrm`               | `source_id`             |
| `priceupd`            | `(source_id, price)`    |

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

| Human price | On-chain value  |
| ----------- | --------------- |
| $0.10       | `1_000_000`     |
| $1.00       | `10_000_000`    |
| $123.45     | `1_234_500_000` |

## Error Codes

| Code | Name                    | Meaning                                          |
| ---- | ----------------------- | ------------------------------------------------ |
| 1    | `AlreadyInitialized`    | `initialize` called more than once               |
| 2    | `NotInitialized`        | Contract not yet initialized                     |
| 3    | `Unauthorized`          | Caller is not the admin or registered reporter   |
| 4    | `SourceNotFound`        | Source ID does not exist                         |
| 5    | `SourceInactive`        | Source has been deactivated                      |
| 6    | `InvalidPrice`          | Price ≤ 0                                        |
| 7    | `StalePrice`            | (reserved)                                       |
| 8    | `InsufficientSources`   | No valid active sources for aggregation          |
| 9    | `ContractPaused`        | Operation blocked while paused                   |
| 10   | `InvalidWeight`         | Weight outside 1–100 range                       |
| 11   | `OutlierDetected`       | (reserved)                                       |
| 12   | `CircuitBreakerTripped` | Price update exceeds `circuit_breaker_bps` swing |
| 13   | `InvalidParameter`      | Config value out of valid range                  |
