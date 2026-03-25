# Profile Registry Example

A simple Soroban contract for managing user profiles. It allows users to store a name and a short bio.

## Usage
The contract implements:
- `set_profile(user: Address, name: String, bio: String)`: allows an authorized address to update its profile details.
- `get_profile(user: Address)`: returns the user's current profile or `null`.

## Requirements
- [Rust](https://www.rust-lang.org/tools/install)
- [Soroban CLI](https://developers.stellar.org/docs/smart-contracts/getting-started/setup)
