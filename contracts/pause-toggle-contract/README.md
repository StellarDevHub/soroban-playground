# Pause Toggle Contract

An emergency circuit-breaker for Soroban smart contracts with separate
Guardian and multi-signature Admin roles.

## Features

- **Guardian** — can pause immediately when an exploit is detected and can
  cancel a pending unpause.
- **Multi-sig Admin** — controls role management, unpause scheduling, and the
  final unpause. The threshold must be at least 2.
- **24-hour unpause timelock** — `schedule_unpause` records an ETA, and
  `execute_unpause` only succeeds once the timelock has elapsed.
- **Emergency withdrawals** — users can recover their own tracked base
  collateral after the contract has been continuously paused for more than
  14 days.
- **Public events** — `paused`, `unpause_scheduled`, `unpause_cancelled`,
  `unpaused`, and `emergency_withdrawal`.

## Contract Interface

| Function                   | Parameters                                | Access              |
| -------------------------- | ----------------------------------------- | ------------------- |
| `initialize` / `init`      | `admins: Vec<Address>, threshold: u32`    | All initial admins  |
| `pause`                    | `caller: Address`                         | Guardian or Admin   |
| `pause_with_reason`        | `caller: Address, reason: String`         | Guardian or Admin   |
| `schedule_unpause`         | `signers: Vec<Address>`                   | Admin quorum        |
| `cancel_unpause`           | `caller: Address`                         | Guardian or Admin   |
| `execute_unpause`          | `signers: Vec<Address>`                   | Admin quorum        |
| `add_guardian`             | `signers: Vec<Address>, guardian: Address`| Admin quorum        |
| `remove_guardian`          | `signers: Vec<Address>, guardian: Address`| Admin quorum        |
| `add_admin`                | `signers: Vec<Address>, admin: Address`   | Admin quorum        |
| `remove_admin`             | `signers: Vec<Address>, admin: Address`   | Admin quorum        |
| `set_admins` / `update_admins` | `signers, new_admins, new_threshold`  | Admin quorum        |
| `set_admin_threshold` / `set_threshold` | `signers, new_threshold`      | Admin quorum        |
| `deposit`                  | `user: Address, amount: i128`             | User                |
| `emergency_withdraw`       | `user: Address`                           | User                |
| `paused`                   | —                                         | Read                |
| `get_pause_reason`         | —                                         | Read                |
| `get_pause_timestamp`      | —                                         | Read                |
| `get_unpause_eta`          | —                                         | Read                |
| `get_admins` / `get_admin` | —                                         | Read                |
| `get_admin_threshold`      | —                                         | Read                |
| `get_guardians`            | —                                         | Read                |
| `balance`                  | `user: Address`                           | Read                |
| `do_action`                | `caller: Address`                         | Any (guarded)       |

## Error Codes

| Code | Variant                        | Meaning                                      |
| ---- | ------------------------------ | -------------------------------------------- |
| 1    | `AlreadyInitialized`           | Contract already initialized                 |
| 2    | `NotInitialized`               | Contract not initialized                     |
| 3    | `Unauthorized`                 | Caller/signer is not authorized              |
| 4    | `AlreadyInState`               | Contract is already paused/unpaused          |
| 5    | `ContractPaused`               | Action blocked by pause guard                |
| 6    | `InsufficientSignatures`       | Admin quorum not reached                     |
| 10   | `GuardianAlreadyAdded`         | Guardian already exists                      |
| 11   | `GuardianNotFound`             | Guardian does not exist                      |
| 12   | `TimeLockNotExpired`           | Unpause timelock has not elapsed             |
| 13   | `InvalidThreshold`             | Threshold is below 2 or above signer count   |
| 16   | `NoPendingUnpause`             | No unpause has been scheduled                |
| 17   | `EmergencyWithdrawNotAllowed`  | Pause duration is not longer than 14 days    |
| 18   | `InsufficientBalance`          | No tracked collateral to withdraw            |
| 19   | `AdminAlreadyAdded`            | Admin already exists                         |
| 20   | `AdminNotFound`                | Admin does not exist                         |
| 21   | `DuplicateSigner`              | Duplicate signer in quorum                   |
| 22   | `InvalidAmount`                | Deposit amount must be positive              |
| 24   | `Overflow`                     | Checked arithmetic overflow                  |

## Events

| Topic                   | Data                                | Emitted When                  |
| ----------------------- | ----------------------------------- | ----------------------------- |
| `init`                  | `(admins, threshold)`               | Contract initialized          |
| `paused`                | `(caller, timestamp)`               | Contract paused               |
| `unpause_scheduled`     | `eta: u64`                          | Unpause scheduled             |
| `unpause_cancelled`     | `caller: Address`                   | Pending unpause cancelled     |
| `unpaused`              | `timestamp: u64`                    | Timelock elapsed, unpaused    |
| `emergency_withdrawal`  | `(user, amount)`                    | User recovered collateral     |

## Security Patterns

- **Separated roles**: Guardians can only pause/cancel; Admin quorum is needed
  for unpausing and role management.
- **Multi-sig quorum**: every signer in the quorum calls `require_auth()` and
  duplicate or non-admin signers are rejected.
- **Mandatory timelock**: unpause ETA is `now + 86_400` seconds.
- **Checks-effects-interactions**: `emergency_withdraw` zeroes the tracked
  balance before the external token transfer, preventing double-withdrawal.
- **Checked arithmetic**: timestamps and balances use checked operations.

## Testing

```bash
cargo test -p pause-toggle-contract
```

The suite covers initialization, guardian/admin role transitions, multi-sig
quorum failures, the 24-hour timelock boundary (`+86_399` / `+86_400`),
cancellation, emergency withdrawals before/after 14 days, double-withdrawal
protection, and full pause/unpause lifecycles.

## Deploying to Testnet

```bash
cargo build --target wasm32-unknown-unknown --release

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/pause_toggle_contract.wasm \
  --source <YOUR_ACCOUNT> \
  --network testnet
```
