# Price Aggregator

A production-ready Soroban price feed aggregator contract for tamper-resistant asset pricing.

## Features

- Supports multiple aggregation strategies:
  - Median
  - Weighted average
  - Trimmed mean
- Source management:
  - `add_source`
  - `remove_source`
  - `set_weight`
- Price updates with source validation and event emission
- Outlier detection for suspicious price reports
- Circuit breaker to reject large unexpected aggregated moves
- Read-only access to aggregated prices and source price data

## Contract Interface

| Function | Description |
|---|---|
| `initialize(admin, strategy, min_valid_sources, outlier_threshold_bps, circuit_breaker_threshold_bps)` | Set contract admin and guardian configuration |
| `add_source(caller, source, weight)` | Register a new price source |
| `remove_source(caller, source)` | Unregister a price source |
| `set_weight(caller, source, weight)` | Update a source weight |
| `update_price(source, symbol, price)` | Publish a price report from a registered source |
| `get_price(symbol)` | Query the active aggregated price using the configured strategy |
| `get_aggregated_price(symbol, strategy)` | Query the aggregated price using a specific strategy |
| `get_source_price(source, symbol)` | Read a source's latest reported price |

## Events

- `SourceAdded`
- `SourceRemoved`
- `WeightUpdated`
- `PriceUpdated`

## Build & Test

```bash
cd contracts/price-aggregator
cargo test
cargo build --target wasm32-unknown-unknown --release
```
