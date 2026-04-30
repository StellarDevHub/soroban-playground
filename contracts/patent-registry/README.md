# Patent Registry

A full-stack patent management system built on Stellar Soroban.

## Architecture

```
contracts/patent-registry/   Soroban smart contract (Rust)
backend/src/
  routes/patents.js          REST API routes
  services/patentService.js  Soroban CLI wrapper
  tests/patent.test.js       Jest unit tests
frontend/src/
  app/patents/page.tsx        Next.js page
  components/PatentRegistryDashboard.tsx  UI
  hooks/usePatentRegistry.ts  API client hook
```

## Smart Contract

### Functions

| Function | Auth | Description |
|---|---|---|
| `initialize(admin)` | admin | One-time setup |
| `file_patent(inventor, title, description, expiry_date)` | inventor | File a new patent (status: Pending) |
| `activate_patent(admin, patent_id)` | admin | Approve a pending patent |
| `revoke_patent(admin, patent_id)` | admin | Revoke an active patent |
| `transfer_patent(owner, patent_id, new_owner)` | owner | Transfer ownership |
| `grant_license(owner, patent_id, licensee, license_type, fee, expiry_date)` | owner | Grant Exclusive or NonExclusive license |
| `file_dispute(claimant, patent_id, reason)` | claimant | Open a dispute |
| `resolve_dispute(admin, dispute_id, resolution)` | admin | Close a dispute |
| `pause(admin)` / `unpause(admin)` | admin | Emergency circuit breaker |

### Events

| Topic | Data | Trigger |
|---|---|---|
| `filed` + inventor | patent_id | Patent filed |
| `activated` | patent_id | Patent activated |
| `revoked` | patent_id | Patent revoked |
| `transfer` + patent_id | new_owner | Ownership transferred |
| `licensed` + patent_id | license_id | License granted |
| `dispute` + patent_id | dispute_id | Dispute filed |
| `resolved` | dispute_id | Dispute resolved |
| `paused` | bool | Pause toggled |

### Build & Test

```bash
cd contracts/patent-registry
cargo test
cargo build --release --target wasm32-unknown-unknown
```

## Backend API

Base path: `/api/patents`

### Endpoints

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/file` | `inventor, title, description, expiryDate` | File patent |
| `POST` | `/:id/activate` | `admin` | Activate patent |
| `POST` | `/:id/revoke` | `admin` | Revoke patent |
| `POST` | `/:id/transfer` | `owner, newOwner` | Transfer patent |
| `POST` | `/:id/license` | `owner, licensee, licenseType, fee, expiryDate` | Grant license |
| `POST` | `/disputes` | `claimant, patentId, reason` | File dispute |
| `POST` | `/disputes/:id/resolve` | `admin, resolution` | Resolve dispute |
| `POST` | `/pause` | `admin` | Pause contract |
| `POST` | `/unpause` | `admin` | Unpause contract |
| `GET` | `/stats` | — | Counts + paused flag |
| `GET` | `/:id` | — | Get patent |
| `GET` | `/licenses/:id` | — | Get license |
| `GET` | `/disputes/:id` | — | Get dispute |

All responses: `{ success: true, data: ... }` or `{ message, statusCode, details? }`.

### Environment Variables

```env
PATENT_CONTRACT_ID=C...          # Deployed contract address
DEFAULT_NETWORK=testnet
SOROBAN_SOURCE_ACCOUNT=G...      # Signing account
```

### Run Tests

```bash
cd backend
npm install
npx jest tests/patent.test.js
```

## Frontend

Navigate to `/patents` in the running app.

Features:
- **Stats bar** — live patent/license/dispute counts and pause status
- **File Patent** — submit a new patent application
- **Patent Lookup** — fetch any patent by ID
- **Admin Actions** — activate or revoke patents
- **Grant License** — issue exclusive or non-exclusive licenses
- **Disputes** — file, resolve, and look up disputes

## Deployment

1. Deploy the contract:
   ```bash
   stellar contract deploy \
     --wasm contracts/patent-registry/target/wasm32-unknown-unknown/release/soroban_patent_registry.wasm \
     --source <ACCOUNT> --network testnet
   ```

2. Initialize:
   ```bash
   stellar contract invoke --id <CONTRACT_ID> --source <ACCOUNT> --network testnet \
     -- initialize --admin <ADMIN_ADDRESS>
   ```

3. Set `PATENT_CONTRACT_ID` in `backend/.env`.

4. Start the stack:
   ```bash
   npm run dev
   ```
