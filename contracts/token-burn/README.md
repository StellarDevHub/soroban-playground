# Token Burn Contract

A Soroban smart contract implementing token burning with deflationary economics and supply tracking.

## Features

- **Token Burning**: Permanently remove tokens from circulation
- **Deflationary Transfers**: Automatically burn a percentage of each transfer
- **Configurable Burn Rate**: Admin-controlled burn rate (0–10000 basis points)
- **Pause/Unpause**: Emergency pause mechanism for burn operations
- **Supply Tracking**: Real-time tracking of total supply and total burned
- **Event Emissions**: All critical actions emit events for off-chain tracking

## Functions

### Initialization

- `init(admin, initial_supply, burn_rate)` – Initialize the contract with admin, supply, and burn rate

### Burn Operations

- `burn(from, amount)` – Burn tokens from an address (requires auth)
- `deflationary_transfer(from, amount)` – Apply burn rate and return net amount

### Admin Functions

- `set_burn_rate(caller, new_rate)` – Update the burn rate (0–10000 bps)
- `pause(caller)` – Pause all burn operations
- `unpause(caller)` – Resume burn operations

### Queries

- `total_supply()` – Get current circulating supply
- `total_burned()` – Get total tokens burned
- `burn_rate()` – Get current burn rate in basis points
- `balance(account)` – Get balance of an account
- `is_paused()` – Check if contract is paused
- `get_admin()` – Get admin address

## Testing

Run the test suite:

```bash
cargo test
```

## Deployment

Build the contract:

```bash
cargo build --release --target wasm32-unknown-unknown
```

The WASM artifact will be at `target/wasm32-unknown-unknown/release/token_burn.wasm`.

## Example Usage

```rust
// Initialize with 1M supply and 2% burn rate
client.init(&admin, &1_000_000, &200);

// Burn 1000 tokens
client.burn(&user, &1000);

// Deflationary transfer: 10000 tokens with 2% burn = 9800 net
let net = client.deflationary_transfer(&user, &10_000);
assert_eq!(net, 9_800);

// Update burn rate to 5%
client.set_burn_rate(&admin, &500);
```

## Security

- Only the admin can pause/unpause and update burn rates
- All burn operations require caller authentication
- Burn amounts are validated against available supply
- Contract can be paused in emergencies
