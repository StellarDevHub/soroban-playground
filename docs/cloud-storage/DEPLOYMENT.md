# Deployment Guide

## Prerequisites

- [Soroban CLI](https://stellar.org/soroban) installed and on PATH.
- Stellar testnet account with sufficient XLM for contract installation and transaction fees.
- Backend server running and configured with `SOROBAN_SOURCE_ACCOUNT` secret key.
- Environment variables set in backend:
  - `SOROBAN_CLI` – path to soroban binary (default `soroban`)
  - `DEFAULT_NETWORK` – e.g. `testnet`
- Frontend environment:
  - `NEXT_PUBLIC_API_BASE_URL` – backend URL
  - `NEXT_PUBLIC_CLOUD_STORAGE_CONTRACT_ID` – deployed contract ID

## Build Contract

```bash
cd contracts/cloud-storage
cargo build --release --target wasm32-unknown-unknown
```

The compiled WASM artifact will be at:
```
target/wasm32-unknown-unknown/release/cloud_storage.wasm
```

## Deploy to Testnet

You can use the backend deploy endpoint or the Soroban CLI directly.

### Via Backend

```bash
curl -X POST http://localhost:5000/api/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "contractName": "cloud-storage",
    "wasmPath": "/abs/path/to/cloud_storage.wasm",
    "sourceAccount": "S...",           // secret key or reference
    "network": "testnet"
  }'
```

### Via CLI

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/cloud_storage.wasm \
  --source-account $SOURCE_ACCOUNT \
  --network testnet
```

Save the returned contract ID.

## Initialize Contract

After deployment, initialise with an admin address:

```bash
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source-account $ADMIN_ACCOUNT \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>
```

Replace `<ADMIN_ADDRESS>` with the Stellar public address of the admin.

## Configure Backend

Add to backend `.env`:

```
CLOUD_STORAGE_CONTRACT_ID=<CONTRACT_ID>
DEFAULT_NETWORK=testnet
SOROBAN_SOURCE_ACCOUNT=<SECRET_KEY_FOR_INVOCATIONS>
```

## Verify Deployment

- Health: `GET /api/cloud-storage/health`
- Register a test node via API and upload a small file via the UI (`/cloud-storage`) or curl.

## Troubleshooting

If deployment fails:
- Ensure the WASM was built with the `cdylib` crate type.
- Check that the source account has enough XLM for the minimum balance increase (rent).
- Verify network connectivity to the Stellar RPC.
