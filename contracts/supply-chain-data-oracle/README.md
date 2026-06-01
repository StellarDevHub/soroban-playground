# Supply Chain Data Oracle Contract

A production-ready logistics data oracle for Soroban applications. Provides tamper-resistant supply chain data with IoT sensor support, multi-source verification, provenance tracking, and circuit breakers.

## Features

- Multi-source logistics data submission and confirmation
- Configurable verification threshold (auto-verifies when confirmations ≥ threshold)
- Provenance trail per shipment ID
- IoT sensor fields: temperature (tenths of °C) and humidity (0–100%)
- Circuit breaker for emergency halts
- Admin pause/unpause

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin, threshold?)` | Public (once) | Initialize contract |
| `add_data_source(admin, source, name)` | Admin | Register a trusted source |
| `remove_data_source(admin, source)` | Admin | Deactivate a source |
| `set_verification_threshold(admin, threshold)` | Admin | Update confirmation threshold |
| `submit_logistics_data(source, shipment_id, origin, dest, carrier, status, temp, humidity)` | Registered source | Submit logistics data |
| `confirm_logistics_data(source, data_id)` | Registered source | Add confirmation |
| `finalize_logistics_data(admin, data_id)` | Admin | Finalize a data entry |
| `set_circuit_breaker(admin, active)` | Admin | Toggle circuit breaker |
| `pause(admin)` / `unpause(admin)` | Admin | Emergency pause |
| `get_logistics_data(data_id)` | Read | Fetch a data entry |
| `get_provenance_data(shipment_id, index)` | Read | Fetch a provenance record |
| `get_provenance_count(shipment_id)` | Read | Number of provenance records |
| `get_data_count()` | Read | Total entries submitted |

## Build & Test

```bash
cd contracts/supply-chain-data-oracle
cargo test
cargo build --target wasm32-unknown-unknown --release
```
