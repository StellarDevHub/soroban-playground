# Cloud Storage API Reference

Base URL: `/api/cloud-storage`

All requests may optionally include headers:
- `x-source-account`: Stellar address to act as transaction source (used by CLI)
- `x-network`: Stellar network (`testnet` or `futurenet`); defaults to `testnet` or `DEFAULT_NETWORK`

---

## Upload File

`POST /files`

Upload a file to decentralized storage. The file is automatically sharded and replicated.

**Request Body:**
```json
{
  "fileId": "C3f3s9K...",          // SHA-256 Contract ID of the file
  "totalSize": 1048576,            // Total size in bytes
  "shardHashes": ["sh1...", "sh2..."], // SHA-256 hash for each shard
  "redundancyFactor": 2,           // Copies per shard (1–5)
  "owner": "G..."                  // Optional; defaults to x-source-account
}
```

**Response (201):**
```json
{
  "success": true,
  "status": "success",
  "message": "File uploaded successfully",
  "data": {
    "owner": "G...",
    "file_id": "C...",
    "total_size": 1048576,
    "shard_count": 4,
    "redundancy_factor": 2,
    "shards": [
      {
        "shard_index": 0,
        "shard_hash": "...",
        "nodes": ["GNodeA", "GNodeB"],
        "size_bytes": 262144
      }
    ],
    "created_at": 1714412345,
    "is_paused": false
  }
}
```

---

## Get File Metadata

`GET /files/:fileId`

Retrieve metadata and shard assignments for a file.

**Response (200):**
```json
{
  "success": true,
  "status": "success",
  "data": { ... FileMetadata ... }
}
```

**Errors:** `404 FileNotFound`

---

## Delete File

`DELETE /files/:fileId`

Delete a file and free its storage on all nodes. Only the owner may delete.

**Headers:**
- `x-caller-address`: Caller's Stellar address (must be owner)

**Response (200):**
```json
{
  "success": true,
  "status": "success",
  "message": "File deleted"
}
```

---

## Register Node

`POST /nodes`

Register a storage node with a given capacity. The node must authenticate as itself (its address is the invoker).

**Request Body:**
```json
{
  "nodeAddress": "GNode123...",
  "capacityBytes": 1048576
}
```

**Response (201):**
```json
{
  "success": true,
  "status": "success",
  "message": "Node registered"
}
```

---

## Get Node Files

`GET /nodes/:nodeAddress/files`

List all file IDs stored on a particular node.

**Response (200):**
```json
{
  "success": true,
  "status": "success",
  "data": ["Cfile1", "Cfile2"]
}
```

---

## Rebalance Shards

`POST /files/:fileId/rebalance`

Redistribute shards to maintain redundancy. Caller must be file owner or admin.

**Headers:**
- `x-caller-address`: Caller address

**Response (200):**
```json
{
  "success": true,
  "status": "success",
  "message": "Rebalance completed"
}
```

---

## Health Check

`GET /health`

Simple health check returning contract ID and network.

**Response (200):**
```json
{
  "status": "ok",
  "contractId": "C...",
  "network": "testnet"
}
```

---

## Error Responses

All endpoints may return error objects:

```json
{
  "success": false,
  "message": "Human readable error",
  "details": ["Additional info"]
}
```

HTTP status codes:
- `400` – Validation error
- `403` – Unauthorized
- `404` – Not found
- `409` – Conflict (e.g., rebalance failed)
- `423` – Contract paused
- `500` – Internal error
