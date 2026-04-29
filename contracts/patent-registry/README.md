# Patent Registry Contract

This Soroban example implements a compact decentralized patent registry with:

- Patent registration and owner-managed updates
- Verifier or admin approval
- License offer creation and acceptance
- Pause and unpause controls for emergency recovery

## Core methods

- `initialize(admin, verifier)`
- `register_patent(owner, title, description, content_hash, metadata_uri)`
- `update_patent(owner, patent_id, title, description, content_hash, metadata_uri)`
- `verify_patent(verifier, patent_id)`
- `create_license_offer(owner, patent_id, terms_uri, payment_amount, payment_token)`
- `update_license_offer(owner, offer_id, terms_uri, payment_amount, payment_token)`
- `accept_license_offer(licensee, offer_id)`
- `pause(admin)`
- `unpause(admin)`

## Local test

```bash
cd contracts/patent-registry
cargo test
```
