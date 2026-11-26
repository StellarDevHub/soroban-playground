# Synthetic assets

This example records one synthetic debt position per staker, backed by one
configured collateral token. All amounts and USD oracle prices use seven decimals.
Synthetic balances are internal records, not transferable token contracts.

## Safety rules

- Minting checks the **entire resulting position** at current prices against the
  existing 400% target. The maintenance floor is 150%; liquidation is permitted
  strictly below it. Collateral is valued down and debt rounded up.
- Both the synthetic price and collateral price must have been reported within
  300 seconds. There is no assumption that collateral always remains worth $1.
  Checks happen on contract calls; an external keeper must submit liquidations.
- A position holds one symbol. Minting/burning another symbol is rejected. Swaps
  must convert the full balance, avoiding mixed units in a single position.
- Minting and swaps start a 12-ledger settlement delay. Burns and subsequent
  swaps are blocked until it expires, including when issuance happens at ledger 0.
- Every mint and burn pays collateral tokens directly from the caller to the
  protocol reserve, in addition to collateral deposits. Fees are rounded up and
  cannot be disabled: 25 bps plus `floor(75 * min(debt / ceiling, 1))` bps.
  Mint uses post-mint asset debt; burn uses pre-burn debt. Swaps pay both fees.
  A caller cannot use the reserve itself to bypass fees through self-transfers.
- Debt ceilings apply to the aggregate supply of each asset, valued at its current
  oracle price. They are checked automatically on mint and swap issuance. Burns
  and liquidations release capacity. A price increase can put existing supply
  over its ceiling; further issuance fails, while repayment remains available.

| Asset tier | USD debt ceiling per asset |
| --- | ---: |
| Experimental (default) | 10,000 |
| Standard | 100,000 |
| Stable | 1,000,000 |

Tier assignment is admin-authorized. Downgrades below current debt are rejected.
These are example risk parameters, not production-calibrated economic limits.

## Setup and calls

1. `initialize(admin, collateral_token)` sets the admin as the initial reserve
   and collateral oracle. No initial collateral price is assumed.
2. `configure_risk(admin, reserve, oracle)` selects a separate reserve recipient
   and collateral reporter. It invalidates the old collateral price.
3. The reporter calls `update_collateral_price(reporter, price)`.
4. Register each synth with `register_asset(admin, symbol, oracle)`, assign its
   tier with `set_asset_tier(admin, symbol, tier)`, and report its price using
   `update_price(reporter, symbol, price)`.
5. `mint(staker, symbol, collateral_amount, synth_amount)` requires enough token
   balance for both the full deposit and the separate stabilization fee.
6. After 12 ledgers, `burn(staker, symbol, amount)` returns proportional collateral
   and separately charges the fee. Partial burns must leave at least 150% backing.
   A full burn closes the position.
7. `swap(staker, from, to, full_balance)` checks both prices, collateral health,
   destination ceiling, and fees, then starts another settlement delay.

`liquidate(liquidator, staker, amount)` requires positive repayment and a ratio
below 150%. Because this example has no transferable synth token, the liquidator
pays the debt's current value in collateral tokens to the reserve. The contract
then transfers collateral worth that repayment plus a 10% bonus, capped by the
position collateral. Full liquidation returns residual collateral to the owner.
Unfunded repayment fails atomically; no free collateral seizure is permitted.

## Compatibility and limits

The mint/burn/swap signatures remain unchanged, but callers must budget fees,
refresh the collateral feed, and honor full-balance swaps and settlement delays.
Existing deployments need risk configuration and fresh prices before resuming.
Previously corrupted mixed-symbol positions require an independently reviewed
migration; this change does not guess their historical balances.

The existing `debt_index` and `total_debt` fields are informational legacy counters,
not the source of health or ceiling decisions. Risk checks use current per-asset
supply and position balances. This example does not implement shared pool debt
redistribution, multiple collateral tokens, or automated off-chain keepers.
Trusted oracle reporters and admin tier choices remain part of its trust model.

## Verification

From the repository root:

```sh
cargo fmt --all -- --check
cargo test --locked -p synthetic-assets
cargo clippy --locked -p synthetic-assets --all-targets -- -D warnings
cargo build --locked -p synthetic-assets --release --target wasm32-unknown-unknown
```

The safety regressions cover repricing existing positions, collateral depegs,
maintenance boundaries, paid liquidations, dynamic reserve fees, shared ceilings,
repayment capacity, swap bypasses, ledger-zero flash cycles, stale feeds, rounding,
overflow and transaction rollback when the caller cannot pay fees.
