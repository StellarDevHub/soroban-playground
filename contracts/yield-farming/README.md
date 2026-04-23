# Yield Farming Aggregator

A Soroban smart contract that aggregates yield strategies with auto-compounding, strategy optimization, and portfolio tracking.

## Features

- **Strategy management** — admin registers strategies with a name and APY (in basis points).
- **Deposits / Withdrawals** — users deposit into any active strategy; withdrawals trigger a compound first.
- **Auto-compounding** — rewards accrue pro-rata over time and are reinvested into the principal. Anyone (e.g. a keeper bot) can trigger `compound` on behalf of a user.
- **Strategy optimization** — admin can update APY or pause/resume strategies at any time.
- **Portfolio tracking** — per-user `Position` records deposited amount, compounded balance, and last-update timestamp across multiple strategies.

## Contract Interface

| Function | Description |
|---|---|
| `initialize(admin)` | One-time setup |
| `add_strategy(admin, name, apy_bps)` | Register a new strategy |
| `update_strategy_apy(admin, id, apy_bps)` | Change a strategy's APY |
| `set_strategy_active(admin, id, active)` | Pause / resume a strategy |
| `deposit(user, strategy_id, amount)` | Deposit into a strategy |
| `withdraw(user, strategy_id, amount)` | Withdraw from a strategy |
| `compound(user, strategy_id)` | Trigger auto-compound for a user |
| `get_strategy(id)` | Read strategy details |
| `get_position(user, id)` | Read user position (with live compounded balance) |
| `list_strategies()` | List all strategy IDs |
| `strategy_count()` | Total number of strategies |

## Build & Test

```bash
cd contracts/yield-farming
cargo test
cargo build --target wasm32-unknown-unknown --release
```
