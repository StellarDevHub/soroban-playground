# Tokenized Real Estate Investment Trust (REIT) Implementation

## Overview

This implementation provides a comprehensive Tokenized REIT system built on the Soroban smart contract platform, with a full-stack architecture including:

- **Smart Contract** (Rust/Soroban): Core business logic with security best practices
- **Backend API** (Node.js/Express): RESTful API with caching and rate limiting
- **Frontend** (React/Next.js): Responsive dashboard with real-time updates

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │   Dashboard  │ │  Properties  │ │   Portfolio  │              │
│  └──────────────┘ └──────────────┘ └──────────────┘              │
│                          │                                         │
│              WebSocket (Real-time Updates)                          │
└──────────────────────────┼──────────────────────────────────────────┘
                         │
┌──────────────────────────┼──────────────────────────────────────────┐
│                         │          BACKEND (Express)                │
│  ┌──────────────────────┼────────────────────────────────────────┐│
│  │                     ▼                                            ││
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       ││
│  │  │   REIT   │  │ Property │  │ Investor │  │ Analytics│       ││
│  │  │  Routes  │  │ Service  │  │ Service  │  │ Service  │       ││
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘       ││
│  │                                                                ││
│  │  ┌────────────────────────────────────────────────────────┐  ││
│  │  │              Rate Limiting & Caching Layer               │  ││
│  │  └────────────────────────────────────────────────────────┘  ││
│  └────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────┘
                         │
                         │ Soroban RPC
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SMART CONTRACT (Soroban)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Property │  │ Ownership│  │ Dividend │  │   REIT Config    │  │
│  │ Storage  │  │ Storage  │  │ Storage  │  │   & Controls     │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## File Structure

```
soroban-playground/
├── contracts/
│   └── tokenized-reit/
│       ├── Cargo.toml
│       ├── src/
│       │   ├── lib.rs          # Main contract implementation
│       │   ├── types.rs        # Data types and errors
│       │   ├── storage.rs      # Storage helpers
│       │   └── test.rs         # Comprehensive test suite
│       └── README.md
├── backend/
│   └── src/
│       ├── routes/
│       │   └── reit.js         # REST API endpoints
│       ├── services/
│       │   └── reitService.js  # Business logic & caching
│       └── websocket.js        # WebSocket integration
├── frontend/
│   └── src/
│       ├── app/
│       │   └── reit/
│       │       └── page.tsx    # REIT page
│       ├── components/
│       │   └── reit/
│       │       ├── ReitDashboard.tsx
│       │       ├── PropertyList.tsx
│       │       ├── InvestorPortfolio.tsx
│       │       └── TransactionHistory.tsx
│       ├── services/
│       │   ├── reitService.ts  # API client
│       │   └── eventBus.ts     # Event handling
│       └── hooks/
│           └── useWallet.ts    # Wallet integration
└── REIT_IMPLEMENTATION.md      # This file
```

## Smart Contract Features

### Core Functionality
- **Property Tokenization**: List properties as fractional shares
- **Investment Management**: Buy/sell shares with pro-rata ownership
- **Dividend Distribution**: Automated pro-rata distribution
- **Share Transfers**: Between investors with automatic dividend settlement
- **Property Lifecycle**: Listed → Funded → Active → Suspended/Delisted

### Security Features
- Emergency pause mechanism
- Access control with admin/modifier pattern
- Whitelist/blacklist support
- Input validation on all inputs
- Checks-Effects-Interactions pattern

### Events
All critical actions emit events:
- `prop_listed` - New property listed
- `shares_buy` - Shares purchased
- `shares_xfer` - Shares transferred
- `div_deposit` - Dividends deposited
- `div_claim` - Dividends claimed
- `paused` - Contract pause state changed

## Backend API

### Endpoints

#### Properties
- `GET /api/reit/properties` - List all properties with filtering
- `GET /api/reit/properties/:id` - Get property details
- `GET /api/reit/properties/stats` - Get property statistics

#### Investors
- `GET /api/reit/investors/:address` - Get investor details
- `GET /api/reit/investors/:address/properties` - Get investor portfolio
- `GET /api/reit/investors/:address/claimable` - Get claimable dividends

#### Transactions
- `GET /api/reit/transactions` - Get transaction history
- `POST /api/reit/transactions` - Log a transaction

#### Analytics
- `GET /api/reit/analytics/dashboard` - Get dashboard data
- `GET /api/reit/analytics/performance` - Get performance metrics
- `GET /api/reit/analytics/yield` - Get yield analytics

#### Contract Interaction
- `POST /api/reit/invoke/buy-shares` - Buy shares
- `POST /api/reit/invoke/claim-dividends` - Claim dividends

### Features
- **Caching**: LRU cache for properties and investor data
- **Rate Limiting**: Configurable limits per endpoint
- **WebSocket**: Real-time updates for transactions and dividends
- **Database**: SQLite with proper indexing for performance

## Frontend Features

### Dashboard
- Performance metrics with time period selection
- Property status distribution charts
- Yield comparison visualizations
- REIT configuration display

### Property List
- Grid view with filtering by status
- Progress bars for funding status
- Buy shares modal with cost calculation
- Responsive pagination

### Investor Portfolio
- Portfolio summary cards
- Properties table with claimable dividends
- One-click dividend claiming
- Investment history

### Transaction History
- Filterable transaction list
- Status indicators
- Pagination support

## Testing

### Smart Contract Tests
The test suite covers:
- Initialization (success and duplicate cases)
- Property listing (validation and success)
- Share purchases (edge cases and blacklisting)
- Share transfers (sufficient funds checks)
- Dividend deposit and claiming
- Pause/unpause functionality
- Whitelist/blacklist operations
- Investor statistics tracking
- Property status transitions
- Batch operations

Run tests:
```bash
cd contracts/tokenized-reit
cargo test
```

## Deployment

### Smart Contract
1. Build the contract:
```bash
cd contracts/tokenized-reit
cargo build --target wasm32-unknown-unknown --release
```

2. Deploy to testnet using soroban-cli

### Backend
1. Install dependencies:
```bash
cd backend
npm install
```

2. Start the server:
```bash
npm run dev
```

### Frontend
1. Install dependencies:
```bash
cd frontend
npm install
```

2. Start development server:
```bash
npm run dev
```

## Environment Variables

### Backend
```env
PORT=5000
NODE_ENV=development
REDIS_URL=redis://localhost:6379
```

### Frontend
```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_REIT_CONTRACT_ID=<contract_id>
```

## Security Considerations

1. **Smart Contract**
   - All admin functions require authorization
   - Pause mechanism for emergency stops
   - Blacklist for preventing malicious actors
   - Overflow protection in arithmetic operations

2. **Backend**
   - Rate limiting on all endpoints
   - Input validation using express-validator
   - SQL injection prevention via parameterized queries
   - CORS configuration for frontend access

3. **Frontend**
   - Wallet connection verification
   - Transaction confirmation dialogs
   - Input sanitization

## Future Enhancements

- [ ] Multi-signature admin support
- [ ] Secondary market for share trading
- [ ] Automated dividend distribution scheduling
- [ ] KYC/AML integration
- [ ] Mobile app
- [ ] Governance token for REIT decisions

## License

MIT License - Copyright (c) 2026 StellarDevTools
