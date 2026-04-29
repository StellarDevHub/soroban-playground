# Token Buyback Contract

A Soroban smart contract implementing an automated token buyback and burn program. Protocol revenue is deposited into a treasury, and the contract periodically purchases tokens from the market and burns them to create deflationary pressure.

## Features

- **Configurable buyback percentage** — set what fraction of treasury revenue is used per buyback (in basis points)
- **Frequency scheduling** — enforce a minimum interval between buybacks
- **Min/max limits** — cap each buyback to a safe range
- **Slippage protection** — 0.5% slippage guard on simulated market purchases
- **Burn verification** — every burn is recorded on-chain with a `BurnRecord`
- **Supply tracking** — cumulative stats track total purchased, burned, and revenue used
- **Emergency pause** — admin can pause the program at any time
- **Event emissions** — `init`, `deposit`, `buyback`, and `burn` events for full transparency

## Functions

| Function | Description |
|---|---|
| `initialize` | Set up admin, token, and buyback parameters |
| `deposit_revenue` | Add revenue to the treasury |
| `execute_buyback` | Run a buyback cycle (purchase + burn) |
| `update_config` | Update buyback parameters (admin only) |
| `set_paused` | Pause or resume the program (admin only) |
| `get_stats` | Read aggregate buyback statistics |
| `get_config` | Read current configuration |
| `get_treasury_balance` | Read current treasury balance |
| `get_purchase_history` | Read last 10 purchase records |
| `get_burn_history` | Read last 10 burn records |

## Build

```bash
cd contracts/token-buyback
cargo build --target wasm32-unknown-unknown --release
```

## Test

```bash
cargo test
```
