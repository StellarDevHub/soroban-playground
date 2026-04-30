# Yield Optimizer Contract

This Soroban example provides a compact cross-protocol yield optimizer with:

- Strategy creation and metadata (protocol, APY, fee, interval)
- User deposit and withdraw flows with share accounting
- Auto-compound execution restricted to admin/executor
- Pause and unpause controls for emergency stop
- Events for strategy create/update, deposit, withdraw, and compound

## Functions

- `initialize(admin, executor)`
- `create_strategy(admin, name, protocol, apy_bps, fee_bps, compound_interval)`
- `update_strategy(admin, strategy_id, apy_bps, fee_bps, compound_interval, is_active)`
- `deposit(user, strategy_id, amount)`
- `withdraw(user, strategy_id, amount)`
- `compound(caller, strategy_id)`
- `pause(admin)` / `unpause(admin)`
- view helpers: `get_strategy`, `get_position`, `list_strategies`

## Backtesting assumptions

Backtesting is implemented in the backend service, not this contract. The contract only stores live strategy state and applies deterministic compounding based on APY and interval.

## Local test

```bash
cd contracts/yield-optimizer
cargo test
```

## Local build

```bash
cd contracts/yield-optimizer
cargo build --target wasm32-unknown-unknown --release
```
