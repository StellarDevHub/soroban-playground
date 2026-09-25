# nft-enumerable

An ERC-721-style NFT contract for Soroban with full on-chain enumeration.

## Features

- Mint / transfer / burn NFTs
- On-chain enumeration: `total_supply`, `token_by_index`, `token_of_owner_by_index`
- Per-token approval and per-owner operator approval
- O(1) swap-and-pop index maintenance on burn

## Enumeration and burn

Storing enumerable token lists on-chain requires careful index management.
When a token is burned this contract uses **swap-and-pop** to avoid O(n) shifts:

1. Find the burned token's position in the list.
2. Copy the *last* element into that position.
3. Pop the last element.

This means the **last token's index changes** after any burn.  Callers that
iterate by index should re-fetch `total_supply` / `balance_of` after each burn.

## Coverage

Coverage is tracked via `cargo-llvm-cov.toml` and `coverage-baseline.json`.
The baseline requires ≥ 85% line coverage and explicitly targets:

- Burn of first / middle / last tokens
- Sequential burn of all tokens
- Cross-owner isolation
- Transfer followed by burn
- Stress: burn every other token in a set of 10

Run coverage:

```bash
cd contracts/nft-enumerable
cargo llvm-cov --package nft-enumerable
```

## Functions

| Function | Access | Description |
|---|---|---|
| `initialize(admin)` | Admin (once) | Set up the contract |
| `mint(admin, to, metadata_uri)` | Admin | Mint a new token |
| `transfer_from(spender, from, to, token_id)` | Owner/Approved | Transfer a token |
| `burn(caller, token_id)` | Owner/Approved/Operator | Burn a token |
| `approve(owner, spender, token_id)` | Owner | Approve a spender |
| `set_approval_for_all(owner, operator, approved)` | Owner | Set operator approval |
| `owner_of(token_id)` | Read | Get token owner |
| `get_approved(token_id)` | Read | Get approved spender |
| `is_approved_for_all(owner, operator)` | Read | Check operator approval |
| `token_uri(token_id)` | Read | Get metadata URI |
| `total_supply()` | Read | Total tokens in existence |
| `token_by_index(index)` | Read | Token ID at global index |
| `balance_of(owner)` | Read | Token count for an owner |
| `token_of_owner_by_index(owner, index)` | Read | Token ID at owner's index |

## Running tests

```bash
cd contracts/nft-enumerable
cargo test
```
