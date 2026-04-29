# Tokenized Real Estate Investment Trust (REIT)

A comprehensive Soroban smart contract implementing a tokenized REIT platform with dividend distribution, share transfers, and comprehensive access control.

## Features

### Core Functionality
- **Property Tokenization**: List real estate properties as fractional shares
- **Investment Management**: Buy/sell property shares with pro-rata ownership
- **Dividend Distribution**: Automated pro-rata dividend distribution to shareholders
- **Share Transfers**: Transfer shares between investors with automatic dividend settlement
- **Property Lifecycle**: Full property status management (Listed → Funded → Active → Suspended/Delisted)

### Security Features
- **Emergency Pause**: Contract-wide pause mechanism for emergency situations
- **Access Control**: Comprehensive admin and investor permission system
- **Blacklist/Whitelist**: Investor screening and property-specific access control
- **Input Validation**: Extensive validation on all user inputs
- **Reentrancy Protection**: State updates before external interactions

### Events & Tracking
All critical actions emit events for off-chain tracking:
- Property listing, status changes, and delisting
- Share purchases, transfers, and sales
- Dividend deposits and claims
- Admin changes and emergency controls
- Whitelist/blacklist updates

## Contract Structure

```
src/
├── lib.rs       # Main contract implementation
├── types.rs     # Data types, errors, and storage keys
├── storage.rs   # Storage helpers and abstractions
└── test.rs      # Comprehensive test suite
```

## Data Types

### Property
```rust
struct Property {
    name: String,                    // Property name
    description: String,             // Property description
    location: String,                // Property location
    total_shares: u64,              // Total fractional shares
    shares_sold: u64,               // Shares already sold
    shares_reserved: u64,           // Reserved shares
    price_per_share: i128,          // Price per share (stroops)
    total_valuation: i128,          // Total property valuation
    pending_dividend: i128,         // Undistributed dividends
    total_dividend_distributed: i128, // Total dividends ever distributed
    status: PropertyStatus,         // Current property status
    target_yield_bps: u32,          // Target annual yield (basis points)
    created_at: u64,                // Creation timestamp
    last_distribution_at: u64,      // Last dividend distribution
    metadata_uri: String,           // IPFS/metadata link
}
```

### Ownership
```rust
struct Ownership {
    shares: u64,                    // Shares held
    dividend_claimed: i128,         // Dividends already claimed
    last_claimed_at: u64,           // Last claim timestamp
}
```

### PropertyStatus
- `Listed`: Accepting investments
- `Funded`: Funding goal reached
- `Active`: Generating returns
- `Suspended`: Temporarily paused
- `Delisted`: Permanently removed

## Contract Functions

### Initialization
- `initialize(admin, name, symbol)` - Initialize the REIT contract

### Admin Functions
- `transfer_admin(current_admin, new_admin)` - Transfer admin rights
- `pause(admin)` / `unpause(admin)` - Emergency controls
- `list_property(...)` - List new property
- `update_property_status(admin, property_id, status)` - Update property status
- `delist_property(admin, property_id)` - Remove property
- `deposit_dividends(admin, property_id, amount, type)` - Deposit dividends

### Access Control
- `whitelist_investor(admin, property_id, investor)` - Whitelist investor
- `remove_whitelist(admin, property_id, investor)` - Remove from whitelist
- `blacklist_investor(admin, investor)` - Global blacklist
- `unblacklist_investor(admin, investor)` - Remove from blacklist

### Investor Functions
- `buy_shares(investor, property_id, shares)` - Purchase shares
- `transfer_shares(from, to, property_id, shares)` - Transfer shares
- `claim_dividends(investor, property_id)` - Claim dividends
- `batch_claim_dividends(investor, property_ids)` - Batch claim across properties

### Query Functions
- `get_property(property_id)` - Get property details
- `get_ownership(investor, property_id)` - Get ownership details
- `claimable_dividends(investor, property_id)` - Calculate claimable amount
- `total_claimable_dividends(investor)` - Total across all properties
- `get_reit_config()` - Get REIT configuration
- `get_investor_stats(investor)` - Get investor statistics
- `get_properties(start, limit)` - Paginated property list
- `get_investor_properties(investor)` - Get investor's properties

## Building

```bash
cd contracts/tokenized-reit
cargo build --target wasm32-unknown-unknown --release
```

## Testing

```bash
cargo test
```

The test suite includes:
- Initialization tests
- Property listing and management tests
- Share purchase and transfer tests
- Dividend distribution and claiming tests
- Pause and emergency control tests
- Whitelist/blacklist tests
- Investor statistics tests
- Property status transition tests
- Query and pagination tests
- Batch operation tests

## Security Considerations

1. **Checks-Effects-Interactions**: All state changes happen before external calls
2. **Access Control**: Strict authorization checks on all admin functions
3. **Input Validation**: Comprehensive validation on all inputs
4. **Overflow Protection**: Using checked arithmetic operations
5. **Pause Mechanism**: Emergency stop for critical situations
6. **Blacklist**: Prevent malicious actors from participating
7. **Reentrancy**: State updates prevent reentrancy attacks

## Integration

The contract integrates with:
- Frontend UI for investor interactions
- Backend API for data aggregation and analytics
- Stellar blockchain for asset settlement

## License

MIT License - Copyright (c) 2026 StellarDevTools
