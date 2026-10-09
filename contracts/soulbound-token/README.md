# Soulbound Token (SBT)

Non-transferable credential token for Soroban that binds verifiable issuer
attestations to a Stellar address. Addresses the production readiness audit
requirements in upstream issue **#1383**.

## Features

- **Non-transferable standard** — `transfer`, `transfer_from` and `approve`
  are permanently disabled, so a credential can never leave its recipient.
- **Cryptographic issuer attestations** — only admin-registered issuers can
  mint, and every attestation is backed by an ed25519 signature over a
  nonce-bound payload. Signatures cannot be replayed or reassigned.
- **Expiration tracking** — attestations may expire; `is_attestation_valid`
  and `has_valid_claim` account for the ledger timestamp.
- **Revocation** — the issuing issuer or the admin can revoke an attestation.
- **Social recovery** — an owner appoints guardians who, once a threshold is
  met, migrate every active attestation to a newly proposed address. This is
  the only path that ever moves a soulbound token.

## Architecture

```
contracts/soulbound-token/
  Cargo.toml
  src/lib.rs      # entry points
  src/storage.rs  # storage helpers
  src/types.rs    # Attestation, RecoveryRequest, Error
  src/test.rs     # unit tests
```

## Data model

| Type               | Fields                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| `Attestation`      | `id`, `issuer`, `recipient`, `claim_type`, `issued_at`, `expires_at`, `status`, `proof_hash` |
| `RecoveryRequest`  | `owner`, `new_owner`, `approvals`, `threshold`, `started_at`, `executed`            |

`expires_at == 0` means the attestation never expires. `proof_hash` is
`sha256(payload)` and commits to the exact statement the issuer signed.

## Signature scheme

An issuer signs the following preimage with its registered ed25519 key:

```
b"SBT1" || pubkey(32) || payload || expiration_be(8) || nonce_be(8)
```

The issuer's nonce is read via `issuer_nonce` and increments after every
successful issuance, so a captured signature can never be reused.

## API

### Admin

| Function                                            | Description                              |
| --------------------------------------------------- | ---------------------------------------- |
| `initialize(admin)`                                 | One-time setup                           |
| `transfer_admin(new_admin)`                         | Hand over admin rights                   |
| `register_issuer(issuer, pubkey)`                   | Register an ed25519 signing key          |
| `remove_issuer(issuer)`                             | Deregister an issuer                     |

### Issuance

| Function                                                                          | Description                         |
| --------------------------------------------------------------------------------- | ----------------------------------- |
| `issue_attestation(issuer, recipient, claim_type, expiration, payload, signature)` | Mint a soulbound attestation        |
| `revoke_attestation(caller, claim_id)`                                             | Revoke (issuer or admin)            |

### Non-transferable enforcement

| Function                                | Result                        |
| --------------------------------------- | ----------------------------- |
| `transfer(...)`                         | `Error::NonTransferable`      |
| `transfer_from(...)`                    | `Error::NonTransferable`      |
| `approve(...)`                          | `Error::ApprovalsDisabled`    |
| `allowance(...)`                        | always `0`                    |
| `non_transferable()`                    | always `true`                 |

### Queries

`balance_of`, `owner_of`, `get_attestation`, `is_attestation_valid`,
`has_valid_claim`, `get_owner_claims`, `attestation_count`,
`is_issuer`, `get_issuer_pubkey`, `issuer_nonce`.

### Social recovery

| Function                                          | Description                                        |
| ------------------------------------------------- | -------------------------------------------------- |
| `set_guardians(owner, guardians, threshold)`      | Configure guardians (owner only)                   |
| `get_guardians(owner)` / `get_guardian_threshold` | Inspect configuration                              |
| `start_recovery(caller, owner, new_owner)`        | Guardian opens a recovery request                  |
| `approve_recovery(guardian, owner)`               | Approve; executes once threshold is met            |
| `cancel_recovery(owner)`                          | Owner cancels an in-flight request                 |
| `get_recovery(owner)`                             | Fetch the request                                  |

## Building and testing

```bash
cd contracts/soulbound-token
cargo build --target wasm32-unknown-unknown --release
cargo test
```

## Events

`init`, `adm_tx`, `iss_reg`, `iss_rm`, `issued`, `revoked`, `grd_set`,
`rec_str`, `rec_app`, `rec_ok`, `rec_cnl`.
