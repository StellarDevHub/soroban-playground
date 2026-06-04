# Upgradeable Contract

Implements the **upgradeable contract pattern** for Soroban applications (Issue #587).

Admins can propose a WASM hash upgrade that becomes executable after a configurable ledger timelock, preserving on-chain state and contract address.

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin, timelock_ledgers)` | Anyone (once) | Bootstrap the contract |
| `propose_upgrade(admin, new_hash)` | Admin | Stage a WASM hash upgrade; executes immediately if timelock is 0 |
| `execute_upgrade(admin)` | Admin | Execute a staged upgrade after the timelock elapses |
| `upgrade_to(admin, new_hash)` | Admin | Alias for `propose_upgrade` (immediate, timelock = 0) |
| `pause(admin)` / `unpause(admin)` | Admin | Emergency halt |
| `get_admin()` | Anyone | Read current admin |
| `is_initialized()` | Anyone | Check init state |
| `is_paused()` | Anyone | Check pause state |
| `get_timelock()` | Anyone | Read timelock delay |
| `get_pending_upgrade()` | Anyone | Read staged (hash, proposed_at) |

## Events

| Topic | Data |
|---|---|
| `init` | admin address |
| `proposed` | (new_hash, ledger_sequence) |
| `upgraded` | new_hash |
| `paused` / `unpaused` | admin address |

## Usage

```rust
// Deploy and initialise with a 100-ledger timelock
client.initialize(&admin, &Some(100u32));

// Admin stages an upgrade
client.propose_upgrade(&admin, &new_wasm_hash);

// After 100+ ledgers, execute
client.execute_upgrade(&admin);
```

## Location

```
contracts/upgradeable/
├── Cargo.toml
└── src/
    ├── lib.rs      — contract logic
    ├── types.rs    — Error, InstanceKey
    ├── storage.rs  — typed storage helpers
    └── test.rs     — test suite
```
