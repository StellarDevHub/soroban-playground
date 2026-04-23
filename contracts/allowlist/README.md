# Allowlist Soroban Example

This is a simple Soroban contract that demonstrates a basic allowlist pattern. It allows an admin to manage a list of "allowed" addresses.

## Features

- **Admin Initialization**: The contract must be initialized with an admin address.
- **Persistent Storage**: Allowlist entries are stored in persistent storage to ensure they last across contract upgrades or long periods of inactivity.
- **Access Control**: Only the registered admin can add or remove addresses from the allowlist.
- **Efficient Lookup**: The `is_allowed` function provides a simple O(1) check for any address.

## Contract Interface

- `initialize(admin: Address)`: Sets the initial admin for the contract. Can only be called once.
- `add(admin: Address, user: Address)`: Adds a user to the allowlist. Requires admin authentication.
- `remove(admin: Address, user: Address)`: Removes a user from the allowlist. Requires admin authentication.
- `is_allowed(user: Address) -> bool`: Returns `true` if the user is in the allowlist, `false` otherwise.
- `get_admin() -> Address`: Returns the current admin address.

## How to use

### Build

```bash
cargo build --target wasm32-unknown-unknown --release
```

### Test

```bash
cargo test
```
