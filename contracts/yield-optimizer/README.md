# Yield Optimizer Contract

This Soroban contract provides cross-protocol yield optimization with:

- Strategy registration, APY updates, and active/inactive controls
- User deposit and withdraw flows with deterministic balance accrual
- Backwards-compatible compounding for existing callers
- Advanced strategy profiles with protocol metadata, fees, harvest costs, risk scores, and minimum profitable compound thresholds
- Risk-adjusted best-strategy selection and portfolio allocation
- Profitable-only auto-compounding that rejects loss-making harvests
- Position rebalancing into the best net-yielding strategy
- Emergency pause and unpause controls

## Functions

- `initialize(admin)`
- `add_strategy(admin, name, apy_bps)`
- `update_apy(admin, strategy_id, new_apy_bps)`
- `set_strategy_active(admin, strategy_id, active)`
- `configure_advanced_strategy(admin, strategy_id, protocol, fee_bps, harvest_cost, min_compound_gain_bps, risk_score)`
- `deposit(user, strategy_id, amount)`
- `withdraw(user, strategy_id, amount)`
- `compound(user, strategy_id)`
- `compound_profitably(user, strategy_id)`
- `preview_compound(user, strategy_id)`
- `allocate(allocations, total_amount)`
- `optimize_allocation(total_amount, max_risk_score)`
- `best_strategy()`
- `best_advanced_strategy(max_risk_score)`
- `rebalance_to_best(user, from_strategy_id, max_risk_score)`
- `backtest(strategy_id, initial_amount, duration_secs)`
- `pause(admin)` / `unpause(admin)`
- view helpers: `get_strategy`, `get_advanced_strategy`, `strategy_score`, `get_position`, `list_strategies`, `strategy_count`, `is_paused`

## Advanced Optimization

Advanced strategy metadata is stored separately from the base strategy record to preserve compatibility with existing deployments and clients. When a strategy has no advanced profile, the optimizer uses default zero-fee, zero-cost, zero-risk metadata.

`compound_profitably` accrues a user's pending reward, subtracts the configured strategy fee and fixed harvest cost, and only writes the compounded balance if the net reward is positive and meets the configured minimum gain threshold.

`optimize_allocation` filters active strategies by `max_risk_score`, scores them by risk-adjusted net APY, and returns allocation weights that sum to 10,000 bps.

## Local Test

```bash
cd contracts/yield-optimizer
cargo test
```

## Local Build

```bash
cd contracts/yield-optimizer
cargo build --target wasm32-unknown-unknown --release
```
