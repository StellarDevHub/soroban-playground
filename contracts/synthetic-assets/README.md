# Synthetic Assets Smart Contract

A comprehensive Soroban smart contract enabling synthetic asset creation, price oracle integration, collateralization management, and derivatives trading.

## Features

### Core Functionality
- **Synthetic Asset Minting**: Create synthetic assets backed by collateral
- **Price Oracle Integration**: Real-time price feeds with confidence scores
- **Collateralization Management**: Automated ratio tracking and health monitoring
- **Liquidation System**: Efficient liquidation mechanism for undercollateralized positions
- **Derivatives Trading**: Long/short leveraged trading positions

### Protocol Parameters
- Minimum Collateral Ratio: 150% (configurable)
- Liquidation Threshold: 120% (configurable)
- Liquidation Bonus: 5% (configurable)
- Trading Fees: 1% (configurable)
- Max Leverage: 10x for derivatives trading

## Contract Architecture

```
lib.rs          - Main contract entry point and public API
types.rs        - Custom data types and error definitions
storage.rs      - Persistent storage operations
oracle.rs       - Price feed management and validation
collateral.rs   - Collateral ratio calculations
 trading.rs      - Derivatives trading calculations
```

## Usage

### Initialize Contract
```rust
contract.initialize(
    admin,
    oracle,
    collateral_token,
    15000, // min collateral ratio (150%)
    12000, // liquidation threshold (120%)
    500,   // liquidation bonus (5%)
    100,   // fee percentage (1%)
);
```

### Register Synthetic Asset
```rust
contract.register_synthetic_asset(
    symbol!("sUSD"),
    "Synthetic USD",
    8,           // decimals
    100000000,   // initial price ($1.00)
);
```

### Mint Synthetic Assets
```rust
contract.mint_synthetic(
    user,
    symbol!("sUSD"),
    30000000000,  // collateral amount
    20000000000,  // mint amount
);
```

### Open Trading Position
```rust
contract.open_trade(
    user,
    symbol!("sUSD"),
    TradeDirection::Long,
    10000000000,  // margin
    20000,        // 2x leverage
);
```

## Testing

Run tests with coverage:
```bash
cargo test
```

Build optimized WASM:
```bash
cargo build --release --target wasm32-unknown-unknown
```

## Gas Optimization

- Uses `opt-level = "z"` for minimum code size
- Persistent storage for critical data only
- Temporary storage for price data with TTL
- Efficient mathematical operations with overflow checks

## Security Considerations

- Authorization checks on all state-changing functions
- Price staleness validation (5-minute max age)
- Confidence score minimum (50%)
- Overflow protection on all arithmetic
- Liquidation ratio safeguards
