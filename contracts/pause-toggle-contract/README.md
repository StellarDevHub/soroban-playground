# Pause Toggle Contract

An emergency circuit-breaker for Soroban smart contracts. Provides admin-controlled pause/unpause functionality, audit information (reason and timestamp), and a guarded action pattern that any contract can adopt.

## Features

- `init(admin)` — one-time initialization
- `pause(caller, reason?)` — halt operations, record why and when
- `unpause(caller)` — resume operations, clear audit data
- `paused()` — read current state
- `get_pause_reason()` — retrieve the reason the contract was paused
- `get_pause_timestamp()` — retrieve the ledger timestamp of the last pause
- `get_admin()` — retrieve the admin address
- `do_action(caller)` — example of a guarded function

## Contract Interface

| Function | Parameters | Returns | Access |
|---|---|---|---|
| `init` | `admin: Address` | `void` | Public (once) |
| `pause` | `caller: Address, reason: Option<String>` | `Result<(), Error>` | Admin only |
| `unpause` | `caller: Address` | `Result<(), Error>` | Admin only |
| `paused` | — | `bool` | Read |
| `get_pause_reason` | — | `Option<String>` | Read |
| `get_pause_timestamp` | — | `Option<u64>` | Read |
| `get_admin` | — | `Result<Address, Error>` | Read |
| `do_action` | `caller: Address` | `Result<(), Error>` | Any (guarded) |

## Error Codes

| Code | Variant | Meaning |
|---|---|---|
| 1 | `Unauthorized` | Caller is not the admin |
| 2 | `ContractPaused` | Action blocked by pause guard |
| 3 | `AlreadyInState` | Already paused / already unpaused |
| 4 | `NotInitialized` | `init` has not been called |

## Events

| Topic | Data | Emitted When |
|---|---|---|
| `init` | `admin: Address` | Contract initialized |
| `paused` | `(caller: Address, timestamp: u64)` | Contract paused |
| `unpaused` | `caller: Address` | Contract unpaused |
| `action` | `caller: Address` | Guarded action executed |

## Security Patterns

- **Admin-only control**: `pause` and `unpause` call `require_auth()` and verify the caller matches the stored admin.
- **Checks-effects-interactions**: state is written before events are emitted.
- **Audit trail**: pause reason and timestamp are stored on-chain and cleared on unpause.
- **No re-entrancy surface**: contract holds no token balances.

## Usage Example

```rust
// In your contract, add a guard to any sensitive function:
fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
    if pause_toggle_client.paused() {
        return Err(Error::ContractPaused);
    }
    // ... transfer logic
}
```

## Building

```bash
cd contracts/pause-toggle-contract
cargo build --target wasm32-unknown-unknown --release
```

## Testing

```bash
cd contracts/pause-toggle-contract
cargo test
```

The test suite contains 60+ cases covering:
- Initialization (single-init enforcement, admin set, default state)
- Pause (flag, reason, timestamp, admin-only, idempotency)
- Unpause (flag cleared, reason cleared, timestamp cleared, admin-only, idempotency)
- `get_pause_reason` (before/after pause, after unpause, across cycles)
- `get_pause_timestamp` (before/after pause, after unpause, across cycles)
- Guarded action (allowed, blocked, allowed again after unpause)
- Full multi-cycle lifecycle
- Property tests (non-admin cannot change state)

## Deploying to Testnet

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Deploy
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/pause_toggle.wasm \
  --source <YOUR_ACCOUNT> \
  --network testnet

# Initialize
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <YOUR_ACCOUNT> \
  --network testnet \
  -- init \
  --admin <ADMIN_ADDRESS>

# Pause with a reason
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network testnet \
  -- pause \
  --caller <ADMIN_ADDRESS> \
  --reason "Security vulnerability patched, halting until audit"

# Check pause reason
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- get_pause_reason

# Unpause
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network testnet \
  -- unpause \
  --caller <ADMIN_ADDRESS>
```

## Backend API

Base URL: `http://localhost:5000/api/pause-toggle`

| Method | Endpoint | Description |
|---|---|---|
| POST | `/init` | Initialize the contract |
| POST | `/pause` | Pause the contract |
| POST | `/unpause` | Unpause the contract |
| GET | `/status?contractId=` | Get paused state |
| GET | `/reason?contractId=` | Get pause reason |
| GET | `/timestamp?contractId=` | Get pause timestamp |
| GET | `/admin?contractId=` | Get admin address |

### Example: Pause with reason

```bash
curl -X POST http://localhost:5000/api/pause-toggle/pause \
  -H "Content-Type: application/json" \
  -d '{
    "contractId": "C...",
    "caller": "G...",
    "reason": "Exploit detected in transfer function"
  }'
```

### Example: Get audit info

```bash
curl "http://localhost:5000/api/pause-toggle/reason?contractId=C..."
curl "http://localhost:5000/api/pause-toggle/timestamp?contractId=C..."
```
