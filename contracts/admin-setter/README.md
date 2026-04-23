# Admin Setter Soroban Example

This is a simple Soroban contract that demonstrates a basic permission-style pattern. It allows an admin to set a value, while preventing non-admin users from doing so.

## Features

- **Admin Initialization**: The contract must be initialized with an admin address.
- **Access Control**: Only the registered admin can update the stored value.
- **Authentication**: Uses Soroban's `require_auth` to verify the admin's identity.

## Contract Interface

- `initialize(admin: Address)`: Sets the initial admin for the contract. Can only be called once.
- `set_value(admin: Address, value: u32)`: Updates the stored value. Requires the `admin` to provide authentication.
- `get_value() -> u32`: Returns the currently stored value.
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
