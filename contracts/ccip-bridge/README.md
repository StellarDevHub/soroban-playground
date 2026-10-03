# CCIP-style Cross-Chain Message Relay

Soroban-side relay that lets contracts react to calls originating on Ethereum,
Solana or Cosmos. Addresses the production readiness audit requirements in
upstream issue **#1378**.

## Features

- **SHA-256 Merkle proof validation** — every message presents a proof that
  resolves to the source chain's approved root.
- **Replay protection** — each `(source chain, nonce)` pair is processed at
  most once; processed nonces and full receipts are stored on-chain.
- **Dynamic XLM gas refunds** — relayers are credited a refund that scales with
  the payload gas and an admin-controlled congestion multiplier, capped by
  `max_refund`. Refunds are claimed via `claim_refund`.

## Architecture

```
contracts/ccip-bridge/
  Cargo.toml
  src/lib.rs      # entry points
  src/storage.rs  # storage helpers
  src/types.rs    # ChainConfig, MessageReceipt, RelayerStats, Error
  src/test.rs     # unit tests
```

## Proof format

Leaves commit to the full `(source chain, nonce, payload)` tuple, so a proof
cannot be replayed for a different chain, nonce or payload:

```
leaf = sha256(b"CCIP1" || chain_id_be(8) || nonce_be(8) || payload)
```

Internal nodes use commutative pair hashing, matching OpenZeppelin-style Merkle
trees:

```
node = sha256(min(a, b) || max(a, b))
```

Both `compute_leaf` and `hash_pair` are exposed as read-only functions so
clients can build and audit trees that the contract will accept.

## Refund formula

```
gas_units = 25_000 + payload_len * 16
refund    = gas_units * gas_price * congestion_bps / 10_000 + base_refund
refund    = min(refund, max_refund)
```

`gas_price` is denominated in stroops per gas unit and `congestion_bps` defaults
to `10_000` (1x).

## API

### Admin

| Function                                            | Description                              |
| --------------------------------------------------- | ---------------------------------------- |
| `initialize(admin, gas_price, max_refund)`          | One-time setup                           |
| `set_paused(paused)`                                | Emergency pause                          |
| `register_relayer(relayer, active)`                 | Register/deregister a relayer            |
| `set_chain_config(chain_id, merkle_root, enabled)`  | Configure a source chain                 |
| `set_merkle_root(chain_id, merkle_root)`            | Rotate a chain's approved root           |
| `set_gas_price(gas_price)`                          | Update refund gas price                  |
| `set_base_refund(base_refund)`                      | Update flat base refund                  |
| `set_max_refund(max_refund)`                        | Update refund cap                        |
| `set_congestion_bps(bps)`                           | Update congestion multiplier             |

### Relayer

| Function                                                                  | Description                                  |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| `execute_cross_chain_message(relayer, chain_id, nonce, payload, proof)`   | Validate a message and credit a refund       |
| `claim_refund(relayer)`                                                   | Withdraw credited XLM refunds                |

### Queries

`get_admin`, `is_initialized`, `is_paused`, `is_relayer`,
`get_chain_config`, `is_nonce_processed`, `get_receipt`, `get_relayer_stats`,
`get_claimable_refund`, `get_gas_price`, `get_base_refund`, `get_max_refund`,
`get_congestion_bps`, `total_refunded`, `total_claimed`, `compute_leaf`,
`hash_pair`.

## Building and testing

```bash
cd contracts/ccip-bridge
cargo build --target wasm32-unknown-unknown --release
cargo test
```

## Events

`init`, `paused`, `relayer`, `chain`, `root`, `executed`, `claimed`.
