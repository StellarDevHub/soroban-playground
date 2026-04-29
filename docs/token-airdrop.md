# Token Airdrop System

A full-stack token airdrop system built on Stellar Soroban, consisting of a Rust smart contract, a Node.js/Express backend API, and a Next.js frontend dashboard.

---

## Architecture

```
frontend/src/app/airdrop/          → Next.js page
frontend/src/components/           → AirdropDashboard, CampaignCard, CampaignDetail, CreateCampaignForm
frontend/src/hooks/useAirdrop.ts   → API client hook

backend/src/routes/airdrop.js      → REST API routes
backend/src/services/airdropService.js → Business logic + Redis cache
backend/tests/airdrop.test.js      → 18 integration tests

contracts/token-airdrop/           → Soroban smart contract (Rust)
```

---

## Smart Contract

**Location:** `contracts/token-airdrop/`

### Functions

| Function | Auth | Description |
|---|---|---|
| `initialize(admin)` | admin | One-time setup |
| `transfer_admin(new_admin)` | admin | Transfer admin role |
| `pause()` | admin | Halt all claims |
| `unpause()` | admin | Resume claims |
| `create_campaign(admin, token, amount_per_claim, total_amount, start, end, require_allowlist)` | campaign admin | Create and fund a campaign |
| `end_campaign(campaign_id)` | campaign admin | End early, reclaim unclaimed tokens |
| `add_to_allowlist(campaign_id, recipients)` | campaign admin | Add up to 200 addresses |
| `remove_from_allowlist(campaign_id, addr)` | campaign admin | Remove one address |
| `claim(campaign_id, claimer)` | claimer | Pull-model claim |
| `batch_distribute(campaign_id, recipients)` | campaign admin | Push-model distribution (up to 100) |
| `get_campaign(id)` | — | Read campaign state |
| `has_claimed(id, addr)` | — | Check claim status |
| `is_eligible(id, addr)` | — | Check eligibility |
| `campaign_count()` | — | Total campaigns |
| `is_paused()` | — | Global pause state |

### Security patterns

- **Checks-effects-interactions**: state is updated before token transfers
- **Access control**: `require_auth()` on all mutating calls
- **Emergency pause**: admin can halt all claims globally
- **Allowlist**: optional per-campaign gating
- **Batch limits**: max 200 for allowlist updates, max 100 for batch distribute

### Build & test

```bash
cd contracts/token-airdrop
cargo test
cargo build --release --target wasm32-unknown-unknown
```

---

## Backend API

**Base URL:** `http://localhost:5000/api/airdrop`

All responses follow `{ success: boolean, data: ... }` or `{ message, statusCode, details? }` on error.

### Endpoints

#### Campaigns

```
GET    /campaigns                       List campaigns (query: status, page, limit)
POST   /campaigns                       Create campaign
GET    /campaigns/:id                   Get campaign
GET    /campaigns/:id/stats             Get stats (claimRate, remainingAmount, etc.)
POST   /campaigns/:id/end               End campaign early
```

#### Allowlist

```
POST   /campaigns/:id/allowlist         Add addresses (body: { addresses: string[] })
DELETE /campaigns/:id/allowlist/:addr   Remove address
```

#### Claims

```
GET    /campaigns/:id/eligibility/:addr Check eligibility
POST   /campaigns/:id/claim             Record claim (body: { address })
```

### Create campaign request body

```json
{
  "admin": "G...",
  "token": "C...",
  "name": "My Airdrop",
  "description": "Optional",
  "amountPerClaim": 100,
  "totalAmount": 10000,
  "startTimestamp": 1700000000,
  "endTimestamp": 1700086400,
  "requireAllowlist": false
}
```

### Caching

Campaign reads are cached in Redis for 30 seconds. Cache is invalidated on writes. Falls back gracefully if Redis is unavailable.

### Rate limiting

The `/api/airdrop` prefix inherits the `invoke` rate limit strategy from the existing middleware chain.

---

## Frontend

**Route:** `/airdrop`

### Components

- **`AirdropDashboard`** — top-level layout, wallet connection, campaign list + detail split view
- **`CampaignCard`** — compact card with progress bar, status badge, key metrics
- **`CampaignDetail`** — full stats, claim button with eligibility check, admin controls
- **`CreateCampaignForm`** — validated form for new campaigns

### Hook: `useAirdrop`

```ts
const {
  loading, error,
  listCampaigns, getCampaign, createCampaign,
  endCampaign, getStats, checkEligibility,
  claim, addToAllowlist,
} = useAirdrop();
```

All methods return `null` on error and set `error` state.

### Accessibility

- All interactive elements have `aria-label` or visible labels
- Progress bars use `role="progressbar"` with `aria-valuenow/min/max`
- Status badges use semantic icons with `aria-hidden="true"`
- Form fields use `<label htmlFor>` associations
- Error messages are associated with their fields

---

## Deployment

### Contract

```bash
# Build
cargo build --release --target wasm32-unknown-unknown

# Deploy to testnet (requires soroban-cli and funded identity)
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soroban_token_airdrop.wasm \
  --source alice \
  --network testnet

# Initialize
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>
```

### Backend

```bash
cd backend
cp .env.example .env   # configure REDIS_HOST, PORT, etc.
npm install
npm start
```

### Frontend

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:5000/api npm run dev
```

---

## Testing

```bash
# Backend (18 tests)
cd backend
node --experimental-vm-modules ../node_modules/.bin/jest tests/airdrop.test.js --config jest.config.cjs

# Contract
cd contracts/token-airdrop
cargo test
```

### Test coverage

| Area | Tests |
|---|---|
| Campaign CRUD | 6 |
| Claim + double-claim | 3 |
| Allowlist management | 3 |
| Eligibility check | 1 |
| End campaign + auth | 2 |
| Stats | 1 |
| Input validation | 2 |
| **Total** | **18** |

---

## Troubleshooting

**Redis not available** — the service logs a warning and continues without caching. No data loss.

**`AlreadyClaimed` error** — each address can claim once per campaign. Use `batch_distribute` for admin push.

**`NotEligible` error** — the campaign has `requireAllowlist: true` and the address hasn't been added. Call `add_to_allowlist` first.

**`AirdropExpired`** — the current ledger timestamp is past `end_timestamp`. End the campaign to reclaim funds.

**`InsufficientFunds`** — all tokens have been claimed. The campaign admin can create a new campaign with more funds.
