# Cloud Storage Contract

## Overview

The Decentralized Cloud Storage contract provides a trustless file storage system on the Stellar network using Soroban smart contracts. Files are split into shards, each replicated across multiple storage nodes, ensuring durability and availability.

Key features:
- **Sharding**: Files are split into configurable shards (up to 64).
- **Redundancy**: Each shard is replicated on multiple nodes (redundancy factor 1–5).
- **Node registry**: Storage nodes can register their capacity and are automatically assigned shards.
- **Access control**: Only file owners can delete files; node registration requires authentication.
- **Pausability**: Admin can pause/unpause the contract for maintenance.
- **Rebalancing**: Automatically redistributes shards when nodes become unhealthy or full.

## Quick Start

1. **Deploy the contract** to Stellar testnet (see DEPLOYMENT.md).
2. **Register storage nodes** via `POST /api/cloud-storage/nodes` or directly via the frontend.
3. **Upload a file** using `POST /api/cloud-storage/files` with the file's SHA-256 hash, total size, per-shard hashes, and redundancy factor.
4. **View files** and shard distribution on the dashboard at `/cloud-storage`.
5. **Rebalance** if needed to maintain redundancy.

## API Endpoints

- `POST /api/cloud-storage/files` — Upload a file
- `GET /api/cloud-storage/files/:fileId` — Get file metadata
- `DELETE /api/cloud-storage/files/:fileId` — Delete a file
- `POST /api/cloud-storage/nodes` — Register a storage node
- `GET /api/cloud-storage/nodes/:nodeAddress/files` — List files on a node
- `POST /api/cloud-storage/files/:fileId/rebalance` — Trigger rebalancing
- `GET /api/cloud-storage/health` — Health check

See `API.md` for detailed request/response schemas.

## Frontend

Navigate to `/cloud-storage` in the playground UI to access the interactive dashboard.
