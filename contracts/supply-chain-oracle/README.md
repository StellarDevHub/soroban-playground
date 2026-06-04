# Supply Chain Oracle Contract

A production-ready supply chain oracle for Soroban applications. Tracks full shipment lifecycle with multi-source consensus, provenance events, circuit breakers, and admin controls.

## Features

- Full shipment lifecycle: Created → InTransit → CustomsHold → Delivered → Finalized
- Multi-source confirmation with configurable threshold (auto-delivers when reached)
- Provenance event trail per shipment
- Circuit breaker for emergency halts
- Admin pause/unpause

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin, threshold?)` | Public (once) | Initialize contract |
| `add_data_source(admin, source, name)` | Admin | Register a trusted source |
| `remove_data_source(admin, source)` | Admin | Deactivate a source |
| `set_verification_threshold(admin, threshold)` | Admin | Update confirmation threshold |
| `submit_logistics_data(source, ref, origin, dest)` | Registered source | Create a new shipment |
| `confirm_shipment(source, shipment_id, location)` | Registered source | Add confirmation; auto-delivers at threshold |
| `update_status(source, shipment_id, status, location)` | Registered source | Update shipment status |
| `finalize_shipment(admin, shipment_id)` | Admin | Finalize a shipment |
| `set_circuit_breaker(admin, active)` | Admin | Toggle circuit breaker |
| `pause(admin)` / `unpause(admin)` | Admin | Emergency pause |
| `get_logistics_data(shipment_id)` | Read | Fetch shipment |
| `get_provenance_data(shipment_id, index)` | Read | Fetch a provenance event |
| `get_provenance_count(shipment_id)` | Read | Number of provenance events |
| `get_shipment_count()` | Read | Total shipments created |

## Shipment Statuses

`Created` → `InTransit` → `CustomsHold` → `Delivered` → `Finalized` (also `Disputed`)

## Build & Test

```bash
cd contracts/supply-chain-oracle
cargo test
cargo build --target wasm32-unknown-unknown --release
```
