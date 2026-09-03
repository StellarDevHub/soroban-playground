# Common Utilities

Standardized Soroban storage helpers shared across the workspace's stateful
contracts. The core helper is [`StorageManager`](src/storage.rs), which wraps
instance / persistent / temporary storage access and **automatically extends
the storage TTL** on every read and write so contract state never gets archived
on Stellar Mainnet due to inactivity.

## Why this matters

Stateful contracts must call `extend_ttl` (or rely on a wrapper that does) on
their storage entries. Without it, an untouched entry is archived once its TTL
expires, permanently locking funds and breaking the contract. `StorageManager`
makes this impossible to forget by bumping TTL on every read and write.

## TTL parameters

| Constant         | Value    | Approx (@ 5s/ledger) |
| ---------------- | -------- | -------------------- |
| `LEDGER_THRESHOLD` | 100,000 | ~5.7 days (renew when below) |
| `EXTEND_LIMIT`   | 500,000  | ~28 days (extend-to) |

## Usage

Depend on this crate (`rlib` is enabled) and call through `StorageManager`:

```rust
use common_utils::storage::StorageManager;

let sm = StorageManager::new(&env);
sm.instance_set(&DataKey::Reserve0, &reserve0);       // writes + extends TTL
let reserve0: i128 = sm.instance_get(&DataKey::Reserve0).unwrap(); // reads + extends TTL
sm.persistent_set(&DataKey::User(user), &amount);
let amount: i128 = sm.persistent_get(&DataKey::User(user)).unwrap_or(0);
```

Available per storage tier (instance / persistent / temporary):
`has`, `get`, `set`, `remove`, plus explicit `bump` helpers.

The `CommonUtils` contract in this crate is a thin demonstration layer so the
manager can be exercised end-to-end and its TTL behavior verified.

## Build & Test

```bash
cd contracts/common-utils
cargo test
cargo build --target wasm32-unknown-unknown --release
```

The tests use the Soroban SDK v21 TTL getter (`get_ttl`) and manual ledger
sequence manipulation to verify that reads and writes extend entry TTLs to
500,000 ledgers, renew them once they drop below the 100,000-ledger threshold,
and leave them untouched above the threshold.