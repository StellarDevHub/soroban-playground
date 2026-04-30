# Patent Registry

This Soroban contract implements a minimal decentralized patent registry.

## Features

- register an invention with title, metadata URI, and metadata hash
- verify inventions with an admin or designated verifier
- update allowed metadata fields by the patent owner
- create and accept license offers
- pause and unpause the registry through the admin

## Contract Functions

- `initialize(admin, verifier)`
- `register_patent(owner, title, metadata_uri, metadata_hash)`
- `update_patent(owner, patent_id, title, metadata_uri, metadata_hash)`
- `verify_patent(caller, patent_id)`
- `set_verifier(admin, verifier)`
- `create_license_offer(owner, patent_id, licensee, terms, payment_amount, payment_currency)`
- `accept_license(licensee, patent_id, license_id, payment_reference)`
- `pause(admin)` / `unpause(admin)`
- `get_patent(patent_id)` / `get_license(license_id)`

## Local Build

```bash
cd contracts/patent-registry
cargo test
cargo build --target wasm32-unknown-unknown --release
``
