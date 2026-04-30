# Tokenized Real Estate

A Soroban smart contract for fractional real estate ownership with rental income distribution and a property investment marketplace.

## Features

- **Property listing** — admin tokenizes properties into a fixed number of fractional shares with a price per share.
- **Investment** — investors buy shares in any listed property; cost = shares × price_per_share.
- **Rental distribution** — admin deposits rental income; investors claim their pro-rata share based on ownership at deposit time (new investors don't retroactively claim old rental).
- **Share transfers** — investors can transfer shares to other addresses; unclaimed rental is settled for the sender before transfer.
- **Delist** — admin can delist a property to stop new investments.

## Contract Interface

| Function | Description |
|---|---|
| `initialize(admin)` | One-time setup |
| `list_property(admin, name, total_shares, price)` | Tokenize a property |
| `delist_property(admin, id)` | Stop new investments |
| `deposit_rental(admin, id, amount)` | Deposit rental income |
| `buy_shares(investor, id, shares)` | Purchase fractional shares |
| `transfer_shares(from, to, id, shares)` | Transfer shares |
| `claim_rental(investor, id)` | Claim pro-rata rental income |
| `claimable_rental(investor, id)` | View claimable amount (read-only) |
| `get_property(id)` / `get_ownership(investor, id)` | Read data |

## Build & Test

```bash
cd contracts/real-estate
cargo test
cargo build --target wasm32-unknown-unknown --release
```
