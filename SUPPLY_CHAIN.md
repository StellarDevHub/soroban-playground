# Supply Chain System

End-to-end supply chain tracking built on Soroban smart contracts, with a Node.js REST API and a Next.js frontend.

---

## Architecture

```
Browser (Next.js)
  └─ /supply-chain page
       └─ fetch → Backend REST API (/api/v1/supply-chain/...)
                    └─ Soroban CLI → Supply Chain Contract (Testnet)
```

---

## Smart Contract

**Location:** `contracts/supply-chain/`

### Functions

| Function | Auth | Description |
|---|---|---|
| `initialize(admin)` | admin | One-time setup |
| `pause(caller)` | admin | Emergency stop — blocks all mutations |
| `unpause(caller)` | admin | Resume operations |
| `paused()` | — | Returns pause state |
| `add_inspector(caller, inspector)` | admin | Grant inspector role |
| `remove_inspector(caller, inspector)` | admin | Revoke inspector role |
| `add_handler(caller, handler)` | admin | Grant handler role |
| `remove_handler(caller, handler)` | admin | Revoke handler role |
| `register_product(owner, name, metadata_hash)` | owner | Register new product, returns `product_id` |
| `add_checkpoint(handler, product_id, location_hash, notes_hash)` | handler | Record location step |
| `update_status(caller, product_id, new_status)` | admin or handler | Set product status |
| `submit_quality_report(inspector, product_id, result, report_hash)` | inspector | QA pass/fail/pending |
| `recall_product(caller, product_id)` | admin | Mark product recalled |
| `get_product(product_id)` | — | Read product data |
| `get_checkpoint(product_id, index)` | — | Read checkpoint |
| `get_checkpoint_count(product_id)` | — | Number of checkpoints |
| `get_quality_report(product_id)` | — | Latest QA report |
| `product_count()` | — | Total registered products |

### Product Statuses

`Registered → InTransit → AtWarehouse → QualityCheck → Approved / Rejected → Delivered`

`Recalled` is a terminal state reachable from any non-recalled status (admin only).

### Events

All mutations emit events for off-chain indexing:

| Topic | Data |
|---|---|
| `init` | `admin: Address` |
| `pause` | `caller: Address` |
| `unpause` | `caller: Address` |
| `reg` | `(product_id: u32, owner: Address)` |
| `chkpt` | `(product_id: u32, index: u32, handler: Address)` |
| `status` | `(product_id: u32, new_status: u32)` |
| `qa` | `(product_id: u32, result: u32, inspector: Address)` |
| `recall` | `product_id: u32` |

### Error Codes

| Code | Meaning |
|---|---|
| 1 | AlreadyInitialized |
| 2 | NotInitialized |
| 3 | Unauthorized |
| 4 | ProductNotFound |
| 5 | InvalidStatus |
| 6 | EmptyName |
| 7 | NotInspector |
| 8 | NotHandler |
| 9 | AlreadyRecalled |
| 10 | QualityReportNotFound |
| 11 | ContractPaused |

### Build & Test

```bash
cd contracts/supply-chain
cargo test
cargo build --release --target wasm32-unknown-unknown
```

---

## Backend API

**Base path:** `/api/v1/supply-chain`

All endpoints accept an optional `?network=testnet` query parameter.

### Endpoints

#### `GET /:contractId/products`
Returns total product count. Result is cached for 60 seconds.

**Response:**
```json
{ "success": true, "count": 5 }
```

#### `GET /:contractId/products/:productId`
Returns a single product.

**Response:**
```json
{ "success": true, "product": { "id": 1, "name": "Widget A", "status": "Registered", ... } }
```

#### `POST /:contractId/products`
Register a new product.

**Body:**
```json
{ "owner": "G...", "name": "Widget A", "metadataHash": 12345, "sourceAccount": "G..." }
```

**Response:**
```json
{ "success": true, "productId": 1 }
```

#### `POST /:contractId/products/:productId/checkpoints`
Add a checkpoint.

**Body:**
```json
{ "handler": "G...", "locationHash": 111, "notesHash": 222, "sourceAccount": "G..." }
```

**Response:**
```json
{ "success": true, "checkpointIndex": 1 }
```

#### `POST /:contractId/products/:productId/quality-report`
Submit a quality report.

**Body:**
```json
{ "inspector": "G...", "result": "Pass", "reportHash": 999, "sourceAccount": "G..." }
```
`result` must be `Pass`, `Fail`, or `Pending`.

#### `POST /:contractId/products/:productId/recall`
Recall a product (admin only on-chain).

**Body:**
```json
{ "caller": "G...", "sourceAccount": "G..." }
```

#### `POST /:contractId/pause`
Pause the contract.

**Body:**
```json
{ "caller": "G...", "sourceAccount": "G..." }
```

#### `POST /:contractId/unpause`
Unpause the contract.

#### `GET /:contractId/paused`
Check pause state.

**Response:**
```json
{ "success": true, "paused": false }
```

### Validation

- `contractId` must match `C[A-Z0-9]{55}`
- `owner`, `handler`, `inspector`, `caller` must match `G[A-Z0-9]{55}`
- `result` must be `Pass`, `Fail`, or `Pending`
- `productId` must be a positive integer

### Error format

```json
{ "success": false, "message": "Validation failed", "details": ["owner is required"] }
```

---

## Frontend

**Route:** `/supply-chain`

### Features

- Contract ID + wallet address configuration
- Product list with status badges and inline actions (Mark Delivered, Recall)
- Register Product form with validation
- Add Checkpoint form
- QA Report form (Pass / Fail / Pending)
- Admin tab: pause / unpause with live state indicator
- Paused banner when contract is halted
- Refresh button with loading spinner
- WCAG 2.1 AA: all inputs labelled, roles on tabs/alerts, aria-invalid on errors

### Environment

Set `NEXT_PUBLIC_API_URL` to point at the backend (defaults to `http://localhost:5000`).

---

## Deployment

### 1. Deploy the contract

```bash
# Build
cd contracts/supply-chain
cargo build --release --target wasm32-unknown-unknown

# Deploy via the Playground UI or CLI
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/soroban_supply_chain.wasm \
  --source <YOUR_ACCOUNT> \
  --network testnet

# Initialize
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_ACCOUNT> \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>
```

### 2. Start the backend

```bash
cd backend
cp .env.example .env   # set SOROBAN_SOURCE_ACCOUNT, REDIS_HOST, etc.
npm install
npm run dev
```

### 3. Start the frontend

```bash
cd frontend
NEXT_PUBLIC_API_URL=http://localhost:5000 npm run dev
```

Navigate to `http://localhost:3000/supply-chain`.

---

## Security

- All mutations require `require_auth()` on the caller address
- Role checks (admin / handler / inspector) enforced on-chain before any state change
- Pause mechanism blocks all mutations in emergencies; read-only views remain available
- Backend validates all inputs before forwarding to the Soroban CLI
- Rate limiting applied via `rateLimitMiddleware` on the supply-chain route
- No secrets stored in contract storage; only hashes of sensitive data

---

## Testing

### Contract (Rust)

```bash
cd contracts/supply-chain
cargo test
```

Covers: initialization, role management, product registration, checkpoints, quality reports, recall, pause/unpause, and all error paths.

### Backend (Jest)

```bash
cd backend
npm test -- tests/supplyChain.test.js
```

Covers: all REST endpoints, input validation, caching, and error responses.
