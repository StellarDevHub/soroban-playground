# Token Airdrop (Merkle)

This contract distributes a fixed allocation of tokens using a Merkle tree.
Recipients prove eligibility with a Merkle proof and claim directly from the
contract balance.

## Core functions

- `initialize(admin, token, merkle_root)`
- `set_merkle_root(admin, merkle_root)`
- `pause(admin)` / `unpause(admin)`
- `transfer_admin(admin, new_admin)`
- `claim(claimant, amount, proof)`
- `is_eligible(claimant, amount, proof)`
- `has_claimed(claimant)`
- `get_root()` / `get_admin()` / `get_token()` / `paused()` / `total_claimed()`

## Merkle leaf format

Leaves are computed as:

```
sha256(utf8("{address}:{amount}"))
```

Where `address` is the Stellar account string (G...) and `amount` is the
base-10 decimal string. The proof is an ordered list of sibling hashes with a
left/right flag.

## Local build

```bash
cd contracts/token-airdrop
cargo build --target wasm32-unknown-unknown --release
```
