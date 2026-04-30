# Data Marketplace

Soroban smart contract for the Decentralized Data Marketplace with Privacy-Preserving Queries and Usage Tracking.

Providers register and list datasets (referenced by manifest, schema, and encryption pubkey hashes — payload stays off-chain). Buyers purchase a `License` granting a bounded number of queries valid until a deadline. To run a query, a buyer submits a SHA-256 *commitment* `H(query || nonce || buyer_pubkey)` — the contract decrements quota and emits an event without ever observing the query content. Per-dataset, per-buyer, and per-provider analytics are maintained on-chain.

## Build

```bash
cargo check --target wasm32-unknown-unknown
cargo test                  # 10 unit tests
cargo build --target wasm32-unknown-unknown --release
```

The release wasm is ~20KB.

## Public functions

| Function | Caller | Purpose |
| --- | --- | --- |
| `initialize(admin)` | deployer | one-time admin bootstrap |
| `set_paused(caller, paused)` | admin | emergency stop |
| `register_provider(provider, name, contact_hash)` | provider | create channel |
| `list_dataset(provider, title, schema_hash, manifest_hash, encryption_pubkey, flat_price, price_per_query, license_seconds)` | provider | publish dataset |
| `update_dataset_price(provider, id, flat_price, price_per_query)` | provider | adjust pricing |
| `delist_dataset(provider, id)` | provider | retire dataset (existing licenses still query) |
| `purchase_access(buyer, dataset_id, max_queries)` | buyer | buy / renew a license |
| `submit_query(buyer, dataset_id, commitment)` | buyer | record privacy-preserving query receipt |
| `verify_commitment(commitment, preimage)` | anyone | reveal-time proof helper |
| `get_*` | anyone | read profile / dataset / license / stats / feed |

## Errors

`AlreadyInitialized`, `NotInitialized`, `Unauthorized`, `Paused`, `ProviderNotFound`, `ProviderAlreadyRegistered`, `DatasetNotFound`, `DatasetDelisted`, `LicenseNotFound`, `LicenseExpired`, `NoQuotaRemaining`, `InvalidAmount`, `SelfPurchaseForbidden`, `SelfQueryForbidden`, `CommitmentAlreadyUsed`, `InvalidParameter`.

## Events

* `("list", provider) → dataset_id`
* `("delist", provider) → dataset_id`
* `("buy", provider, dataset_id) → (buyer, cost)`
* `("query", provider, dataset_id) → (buyer, commitment)`
* `("pause", caller) → bool`

## Privacy model

The off-chain query pipeline is:

1. The buyer constructs a query (e.g. `SELECT count(*) WHERE country='NG'`) and a fresh random `nonce`.
2. The buyer computes `commitment = SHA-256(query || nonce || buyer_pubkey)` locally — the contract uses the same construction in `verify_commitment` so anyone can audit.
3. The buyer encrypts `(query, nonce)` against the dataset's `encryption_pubkey` and sends it directly to the provider over an off-chain channel (or a TEE).
4. The buyer calls `submit_query(commitment)` — quota is decremented, the receipt is stored, and an event is emitted. The query content never appears on-chain.
5. If the buyer disputes (provider failed to deliver), they reveal `(query, nonce)` and any third party calls `verify_commitment` to confirm the on-chain commitment matches.

Replay is prevented because each commitment is unique (`CommitmentAlreadyUsed`).

## Security notes

* `require_auth` is enforced on every state mutation.
* All errors are typed; no raw `panic!` strings are used.
* Providers cannot purchase or query their own datasets (prevents wash usage).
* Saturating arithmetic on counters; checked multiplication on cost calculation.
* Admin can pause the contract; while paused, all mutations short-circuit with `Error::Paused`.
* Contract is asset-agnostic — token settlement is performed by the wrapping client in the same auth bundle.
