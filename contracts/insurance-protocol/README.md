# Decentralized Insurance Protocol

A Soroban smart contract providing a decentralized insurance marketplace with risk assessment, claim voting, and coverage management.

## Features

- **Coverage marketplace** — admin lists products with name, premium, coverage amount, and a risk score (1–100).
- **Policy purchase** — users buy a 1-year policy for any active product.
- **Claim filing** — policyholders file claims with a description while their policy is active.
- **Claim voting** — any address can vote approve/reject during a 7-day window; duplicate votes are rejected.
- **Claim finalisation** — after the voting window, anyone can finalise; requires ≥ 3 votes; majority wins.

## Contract Interface

| Function | Description |
|---|---|
| `initialize(admin)` | One-time setup |
| `list_product(admin, name, premium, coverage, risk)` | Add a coverage product |
| `deactivate_product(admin, id)` | Remove product from marketplace |
| `buy_policy(holder, product_id)` | Purchase a 1-year policy |
| `file_claim(claimant, policy_id, description)` | File a claim |
| `vote_claim(voter, claim_id, approve)` | Vote on a pending claim |
| `finalise_claim(claim_id)` | Finalise after voting window |
| `get_product(id)` / `get_policy(id)` / `get_claim(id)` | Read data |

## Build & Test

```bash
cd contracts/insurance-protocol
cargo test
cargo build --target wasm32-unknown-unknown --release
```
