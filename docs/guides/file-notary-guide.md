# File Notary Guide

Decentralized file notarization using a Soroban smart contract on Stellar Testnet.

## Architecture

```
Browser (Next.js)
  │
  │  SHA-256 hash computed client-side (Web Crypto API)
  │
  ▼
Backend (Express)
  │  POST /api/notary/notarize
  │  GET  /api/notary/verify/:fileHash
  │  DEL  /api/notary/revoke/:fileHash
  │  GET  /api/notary/history
  │
  ├── notaryService.js  ──►  SQLite cache (notary_records)
  │
  └── (production) Soroban CLI  ──►  file-notary contract on Stellar Testnet
                                          │
                                          ▼
                                   Stellar Ledger
                                   (immutable record)
```

The contract stores `NotaryRecord { owner, timestamp, metadata, verified }` keyed by `BytesN<32>` file hash. The backend caches records in SQLite for fast reads and pagination.

---

## Deploy the Contract

### Prerequisites

- Rust + `wasm32-unknown-unknown` target
- Stellar CLI (`stellar`)
- Funded testnet account

### Build

```bash
cd contracts/file-notary
cargo build --target wasm32-unknown-unknown --release
```

### Deploy to Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/file_notary.wasm \
  --source <YOUR_SECRET_KEY> \
  --network testnet
```

Copy the printed contract ID and set it in `backend/.env`:

```
NOTARY_CONTRACT_ID=C...
```

### Initialize

```bash
stellar contract invoke \
  --id $NOTARY_CONTRACT_ID \
  --source <YOUR_SECRET_KEY> \
  --network testnet \
  -- initialize \
  --admin <YOUR_PUBLIC_KEY>
```

---

## Run Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set NOTARY_CONTRACT_ID and STELLAR_NETWORK
npm install
npm run dev
```

The API listens on `http://localhost:5000`.

---

## Run Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Navigate to the Notary section to notarize and verify files.

---

## API Usage Examples

### Notarize a file

```bash
curl -X POST http://localhost:5000/api/notary/notarize \
  -H "Content-Type: application/json" \
  -d '{
    "fileHash": "a3f1e2d4b5c6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    "metadata": "Contract v1.0 signed 2026-04-29",
    "callerAddress": "GABC123XYZ"
  }'
```

Response:
```json
{
  "success": true,
  "data": { "recordId": 1714384791, "timestamp": 1714384791 }
}
```

### Verify a file

```bash
curl http://localhost:5000/api/notary/verify/a3f1e2d4b5c6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
```

Response:
```json
{
  "success": true,
  "data": {
    "fileHash": "a3f1e2d4...",
    "owner": "GABC123XYZ",
    "timestamp": 1714384791,
    "metadata": "Contract v1.0 signed 2026-04-29",
    "verified": true,
    "recordId": 1714384791
  }
}
```

### Revoke a notarization

```bash
curl -X DELETE http://localhost:5000/api/notary/revoke/a3f1e2d4b5c6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2 \
  -H "Content-Type: application/json" \
  -d '{ "callerAddress": "GABC123XYZ" }'
```

### List history

```bash
curl "http://localhost:5000/api/notary/history?page=1&limit=20"
```

---

## User Guide

### How to Notarize a File

1. Open the **Notarize File** panel.
2. Click **Select a file** — the SHA-256 hash is computed in your browser (the file is never uploaded).
3. Enter a description in the **Metadata** field (max 500 characters).
4. Click **Notarize File**.
5. On success, a certificate is displayed with the record ID and timestamp. Click **Download Certificate** to save it as JSON.

### How to Verify a File

1. Open the **Verify File** panel.
2. Either upload the file (hash computed automatically) or paste the 64-character hex hash.
3. Click **Verify File**.
4. The result shows the owner address, timestamp, metadata, and whether the record is **Verified** or **Revoked**.

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `409 File already notarized` | Hash already on-chain | Each file can only be notarized once |
| `400 fileHash must be 64-character hex` | Wrong hash format | Use SHA-256 (64 hex chars) |
| `403 Unauthorized` on revoke | Wrong caller address | Only the original owner can revoke |
| `429 Too Many Requests` | Rate limit (10 req/min) | Wait 60 seconds and retry |
| Contract call fails | `NOTARY_CONTRACT_ID` not set | Set the env var and restart backend |
| SQLite locked | Concurrent writes | Restart backend; SQLite is single-writer |
