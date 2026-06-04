# Registry Integration

A Soroban example demonstrating centralized contract registry integration and metadata management.

## Features

- `initialize(admin)` — one-time setup with a registry administrator
- `register_with_registry(caller, contract_address, metadata)` — register a contract with the registry
- `unregister_from_registry(caller, contract_address)` — voluntarily remove a contract from the registry
- `get_registry_info(contract_address)` — query published registry details
- `set_registry_metadata(caller, contract_address, metadata)` — update metadata for an active registration
- `get_registry_metadata(contract_address)` — read published metadata
- `revoke_registration(admin, contract_address)` — admin revocation for emergency cleanup

## Security

- `caller` authorization is required for registration and metadata updates
- only the registered owner or admin can modify registrations
- metadata is validated for non-empty content and a safe maximum length
- events are emitted for registration, unregistration, metadata updates, and revocations

## Build

```bash
cd contracts/registry-integration
cargo build --target wasm32-unknown-unknown --release
```

## Test

```bash
cd contracts/registry-integration
cargo test
```
