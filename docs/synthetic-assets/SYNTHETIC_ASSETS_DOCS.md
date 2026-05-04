# Synthetic Assets System Documentation

## Overview

The Synthetic Assets system is a comprehensive DeFi protocol that enables users to create, trade, and manage synthetic assets backed by collateral on the Stellar blockchain. The system comprises three main components:

1. **Smart Contract** (Rust/Soroban) - Core protocol logic and state management
2. **Backend API** (Node.js/Express) - REST endpoints and contract interaction
3. **Frontend UI** (React/Next.js) - User-facing interface

## Architecture

### System Design

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React/Next.js)                 │
│  ├─ Dashboard & Analytics                                    │
│  ├─ Real-time WebSocket Updates                             │
│  └─ Multi-asset Management                                   │
└────────────────────────┬────────────────────────────────────┘
                         │ REST API + WebSocket
┌────────────────────────v────────────────────────────────────┐
│                  Backend (Node.js/Express)                   │
│  ├─ API Routes & Validation                                 │
│  ├─ Caching & Rate Limiting                                 │
│  ├─ Database Services                                        │
│  └─ WebSocket Management                                     │
└────────────────────────┬────────────────────────────────────┘
                         │ Contract Invocation
┌────────────────────────v────────────────────────────────────┐
│           Smart Contract (Soroban/Rust)                      │
│  ├─ Position Management                                      │
│  ├─ Collateral Tracking                                      │
│  ├─ Price Oracle Integration                                │
│  └─ Liquidation Mechanism                                    │
└────────────────────────┬────────────────────────────────────┘
                         │
             ┌───────────┴──────────┐
             │                      │
         ┌───v──────┐         ┌────v──────┐
         │   Oracle │         │ Collateral │
         │   Feeds  │         │  Token     │
         └──────────┘         └────────────┘
```

## Smart Contract API

### Key Functions

#### Admin Functions

**Initialize Contract**
```rust
initialize(
  env: Env,
  admin: Address,
  oracle: Address,
  collateral_token: Address,
  min_collateral_ratio: u32,      // 15000 = 150%
  liquidation_threshold: u32,     // 12000 = 120%
  liquidation_bonus: u32,         // 500 = 5%
  fee_percentage: u32             // 100 = 1%
) -> Result<(), Error>
```

**Register Synthetic Asset**
```rust
register_synthetic_asset(
  env: Env,
  asset_symbol: Symbol,
  asset_name: String,
  decimals: u32,
  initial_price: i128
) -> Result<(), Error>
```

#### User Functions

**Mint Synthetic Assets**
```rust
mint_synthetic(
  env: Env,
  user: Address,
  asset_symbol: Symbol,
  collateral_amount: i128,
  mint_amount: i128
) -> Result<(), Error>
```

**Burn Synthetic Assets**
```rust
burn_synthetic(
  env: Env,
  user: Address,
  position_id: u64,
  burn_amount: i128
) -> Result<(), Error>
```

**Open Trading Position**
```rust
open_trade(
  env: Env,
  user: Address,
  asset_symbol: Symbol,
  direction: TradeDirection,      // Long or Short
  margin: i128,
  leverage: u32                   // 10000 = 1x, 100000 = 10x
) -> Result<u64, Error>
```

**Close Trading Position**
```rust
close_trade(
  env: Env,
  user: Address,
  position_id: u64
) -> Result<i128, Error>
```

#### View Functions

**Get Position Details**
```rust
get_position(env: Env, position_id: u64) -> Result<CollateralPosition, Error>
get_trading_position_info(env: Env, position_id: u64) -> Result<TradingPosition, Error>
```

**Get Metrics**
```rust
get_collateral_ratio(env: Env, position_id: u64) -> Result<i128, Error>
get_health_factor(env: Env, position_id: u64) -> Result<i128, Error>
is_liquidatable(env: Env, position_id: u64) -> Result<bool, Error>
```

## Backend API Endpoints

All endpoints use JWT authentication (except GET endpoints for public data).

### Asset Management

**Register Asset**
```http
POST /v1/synthetic-assets/register
Content-Type: application/json

{
  "symbol": "sUSD",
  "name": "Synthetic USD",
  "decimals": 8,
  "initialPrice": 100000000
}

Response:
{
  "success": true,
  "data": { ... }
}
```

### Position Management

**Mint Synthetic Assets**
```http
POST /v1/synthetic-assets/mint
Content-Type: application/json

{
  "userAddress": "GABC...",
  "assetSymbol": "sUSD",
  "collateralAmount": 3000000000,
  "mintAmount": 2000000000
}

Response:
{
  "success": true,
  "positionId": 1,
  "data": { ... }
}
```

**Burn Synthetic Assets**
```http
POST /v1/synthetic-assets/burn
Content-Type: application/json

{
  "userAddress": "GABC...",
  "positionId": 1,
  "burnAmount": 1000000000
}
```

**Add Collateral**
```http
POST /v1/synthetic-assets/add-collateral
Content-Type: application/json

{
  "userAddress": "GABC...",
  "positionId": 1,
  "additionalCollateral": 500000000
}
```

### Trading

**Open Trade**
```http
POST /v1/synthetic-assets/open-trade
Content-Type: application/json

{
  "userAddress": "GABC...",
  "assetSymbol": "sUSD",
  "direction": "Long",
  "margin": 1000000000,
  "leverage": 20000  // 2x
}

Response:
{
  "success": true,
  "positionId": 5
}
```

**Close Trade**
```http
POST /v1/synthetic-assets/close-trade
Content-Type: application/json

{
  "userAddress": "GABC...",
  "positionId": 5
}

Response:
{
  "success": true,
  "finalAmount": 1100000000
}
```

### Data Retrieval

**Get Position Details**
```http
GET /v1/synthetic-assets/position/:id

Response:
{
  "success": true,
  "data": {
    "positionId": 1,
    "userAddress": "GABC...",
    "assetSymbol": "sUSD",
    "collateralAmount": 3000000000,
    "mintedAmount": 2000000000,
    "ratio": 15000,
    "healthFactor": 1.25,
    "status": "OPEN",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

**Get Asset Price**
```http
GET /v1/synthetic-assets/price/:symbol

Response:
{
  "success": true,
  "data": {
    "price": 100000000,
    "timestamp": 1705315800,
    "confidence": 95
  }
}
```

**Get Protocol Parameters**
```http
GET /v1/synthetic-assets/params

Response:
{
  "success": true,
  "data": {
    "minCollateralRatio": 15000,
    "liquidationThreshold": 12000,
    "liquidationBonus": 500,
    "feePercentage": 100
  }
}
```

**Get Registered Assets**
```http
GET /v1/synthetic-assets/assets

Response:
{
  "success": true,
  "data": [
    "sUSD",
    "sBTC",
    "sETH"
  ]
}
```

## Frontend Usage

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Using the Dashboard

1. **Connect Wallet**: Click "Connect Wallet" to authenticate with Stellar
2. **Select Asset**: Choose a synthetic asset to interact with
3. **Mint Assets**: Provide collateral and mint synthetic assets
4. **Monitor Position**: Track your collateral ratio and health factor
5. **Trade**: Open leveraged long or short positions
6. **Close Position**: Exit trades to realize profits/losses

### Real-time Updates

The dashboard automatically updates:
- Asset prices (every 5 seconds)
- Position metrics (every 30 seconds)
- Liquidation alerts (immediate)

## Database Schema

### Tables

**positions**
- Stores collateral and trading positions
- Indexes on user_address, asset_symbol, status

**synthetic_assets**
- Metadata for each synthetic asset
- Symbol, name, decimals, total supply

**asset_prices**
- Historical price data
- Timestamp, price, confidence score

**synthetic_asset_events**
- Event log for all operations
- Mint, burn, trade, liquidation events

**liquidation_alerts**
- Positions at risk of liquidation
- Alert timestamp, resolution status

See `backend/migrations/V003__synthetic_assets.up.sql` for complete schema.

## Security Considerations

### Smart Contract

1. **Authorization Checks**: All state-changing functions require user authentication
2. **Overflow Protection**: All arithmetic operations check for overflow
3. **Reentrancy Protection**: Uses checks-effects-interactions pattern
4. **Price Validation**: Validates price staleness and confidence

### Backend

1. **Rate Limiting**: 100 requests per minute per user
2. **Input Validation**: All inputs validated against schema
3. **SQL Injection Prevention**: Uses parameterized queries
4. **CORS Protection**: Restricted to trusted domains

### Frontend

1. **XSS Prevention**: All user input sanitized
2. **CSRF Protection**: Uses secure tokens
3. **Key Management**: Private keys never transmitted to backend

## Monitoring & Analytics

### Key Metrics

- Total value locked (TVL)
- Synthetic assets minted
- Trading volume
- Liquidation events
- Protocol health factor

### Alerts

- Price volatility warnings
- Liquidation alerts
- Contract upgrade notifications
- Emergency pause events

## Deployment

### Environment Variables

```bash
# Backend
SYNTHETIC_ASSETS_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB5C
COLLATERAL_TOKEN=GBUQWP3BOUZX34ULNQG23RQ6F6AZNXQHTLZNQFTMOEDNZTE5P2MKIALIZEQ
ORACLE_ADDRESS=GABC...
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Frontend
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_NETWORK=testnet
```

### Deployment Steps

1. **Smart Contract**
   ```bash
   cd contracts/synthetic-assets
   cargo build --release --target wasm32-unknown-unknown
   soroban contract deploy --network testnet --wasm target/wasm32-unknown-unknown/release/synthetic_assets.wasm
   ```

2. **Backend**
   ```bash
   cd backend
   npm install
   npm run migrate
   npm start
   ```

3. **Frontend**
   ```bash
   cd frontend
   npm install
   npm run build
   npm start
   ```

## Testing

### Smart Contract Tests

```bash
cd contracts/synthetic-assets
cargo test --lib
```

Test coverage: >90%
- Unit tests for all functions
- Integration tests for complex flows
- Edge case tests for error handling

### Backend Tests

```bash
cd backend
npm test
```

Test coverage: >85%
- API endpoint tests
- Service layer tests
- Database integration tests

### Frontend Tests

```bash
cd frontend
npm test
```

Test coverage: >80%
- Component unit tests
- Integration tests
- E2E tests for key user flows

## Troubleshooting

### Common Issues

**Position minting fails with "InsufficientCollateral"**
- Ensure collateral amount meets minimum ratio
- Check: `collateral >= (mint_amount * price * min_ratio) / 10000`

**Position is liquidatable**
- Add more collateral or burn some synthetic assets
- Ensure collateral ratio > liquidation threshold

**WebSocket connection drops**
- Check network connectivity
- Verify API server is running
- Check browser console for errors

**Transaction fails with "Unauthorized"**
- Verify wallet is connected
- Check that transaction is signed correctly
- Ensure sufficient account balance for fees

## Support & Resources

- **GitHub**: https://github.com/your-org/soroban-playground
- **Documentation**: https://docs.example.com
- **Discord**: https://discord.gg/example
- **Issues**: GitHub Issues

## License

MIT License - See LICENSE file for details
