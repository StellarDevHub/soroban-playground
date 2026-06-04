# Sports Results Oracle Contract

A production-ready sports results oracle for Soroban applications. Provides tamper-resistant sports data with multi-source verification, circuit breakers, and admin controls.

## Features

- Multi-source data submission and confirmation
- Configurable verification threshold (auto-verifies when confirmations ≥ threshold)
- Circuit breaker for emergency halts
- Admin pause/unpause
- Event emissions for all state changes

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin, threshold?)` | Public (once) | Initialize contract |
| `add_data_source(admin, source, name)` | Admin | Register a trusted data source |
| `remove_data_source(admin, source)` | Admin | Deactivate a data source |
| `set_verification_threshold(admin, threshold)` | Admin | Update confirmation threshold |
| `submit_sports_data(source, sport, event_id, home, away, home_score, away_score)` | Registered source | Submit a sports result |
| `confirm_result(source, result_id)` | Registered source | Add confirmation to a result |
| `finalize_result(admin, result_id)` | Admin | Finalize a result |
| `set_circuit_breaker(admin, active)` | Admin | Toggle circuit breaker |
| `pause(admin)` / `unpause(admin)` | Admin | Emergency pause |
| `get_sports_data(result_id)` | Read | Fetch a result |
| `get_historical_results(from_id, count)` | Read | Count available results |
| `get_result_count()` | Read | Total results submitted |
| `get_threshold()` | Read | Current verification threshold |
| `get_data_source(source)` | Read | Fetch source info |

## Events

| Event | Data |
|---|---|
| `init` | admin address |
| `srcAdd` | source address |
| `srcRm` | source address |
| `submit` | (result_id, submitter) |
| `verified` | result_id |
| `final` | result_id |
| `cb` | active bool |
| `paused` / `unpaused` | admin address |

## Build & Test

```bash
cd contracts/sports-results-oracle
cargo test
cargo build --target wasm32-unknown-unknown --release
```
