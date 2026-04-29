# Cloud Storage Contract Reference

## Contract Overview

- **Name**: `cloud-storage`
- **Version**: 0.1.0
- **License**: MIT
- **Language**: Rust (Soroban SDK 21.0.6)
- **WASM target**: `wasm32-unknown-unknown`

## Function Summary

| Function | Parameters | Description |
|----------|------------|-------------|
| `initialize(admin)` | `admin: Address` | Initialise contract with admin address. Must be called once. |
| `upload_file(owner, file_id, total_size, shard_hashes, redundancy_factor)` | `owner: Address`, `file_id: BytesN<32>`, `total_size: u64`, `shard_hashes: Vec<BytesN<32>>`, `redundancy_factor: u32` | Upload a file, create shard assignments, emit `FileUploaded`. |
| `get_file(file_id)` | `file_id: BytesN<32>` | Return `FileMetadata` for the given file. |
| `get_shard(file_id, shard_index)` | `file_id: BytesN<32>`, `shard_index: u32` | Return `ShardInfo` for that shard. |
| `delete_file(caller, file_id)` | `caller: Address`, `file_id: BytesN<32>` | Delete file and all its shards; frees node capacity. Emits `FileDeleted`. |
| `register_node(node, capacity_bytes)` | `node: Address`, `capacity_bytes: u64` | Register or update a storage node. Emits `NodeRegistered`. |
| `get_node_files(node)` | `node: Address` | Return list of file IDs stored on that node. |
| `rebalance_shards(caller, file_id)` | `caller: Address`, `file_id: BytesN<32>` | Redistribute shards to healthy nodes. Emits `ShardsRebalanced`. |
| `pause_contract(admin)` | `admin: Address` | Pause the contract (disables upload/delete). Emits `ContractPaused`. |
| `unpause_contract(admin)` | `admin: Address` | Unpause. Emits `ContractUnpaused`. |

## Events

| Event | Topics | Description |
|-------|--------|-------------|
| `FileUploaded` | file_id, owner, shard_count, total_size | A new file has been registered. |
| `ShardAssigned` | file_id, shard_index, node | One shard assigned to a node. |
| `NodeRegistered` | node, capacity_bytes | A storage node joined the network. |
| `FileDeleted` | file_id, caller | A file was deleted. |
| `ShardsRebalanced` | file_id | Rebalancing completed for a file. |
| `ContractPaused` | admin | Contract paused. |
| `ContractUnpaused` | admin | Contract resumed. |

## Error Codes

All errors are `ContractError` enum:

| Code | Variant | Meaning |
|------|---------|---------|
| 1 | AlreadyInitialized | `initialize` called twice |
| 2 | NotInitialized | Contract not yet initialised |
| 3 | Unauthorized | Caller lacks required permission |
| 4 | FileNotFound | File ID does not exist |
| 5 | FileAlreadyExists | Duplicate upload |
| 6 | NotFileOwner | Caller is not file owner |
| 7 | InvalidShardCount | `shard_count > 64` or zero |
| 8 | InvalidRedundancyFactor | Factor not in 1..5 |
| 9 | ShardCountMismatch | `shard_hashes.len()` ≠ `shard_count` |
| 10 | EmptyShardHash | A shard hash is zero |
| 11 | NodeNotFound | Node address not registered |
| 12 | InsufficientNodeCapacity | Node lacks free space |
| 13 | ShardAssignmentMissing | Shard record missing during rebalance |
| 14 | RebalanceFailed | Could not find replacement nodes |
| 15 | InvalidTotalSize | `total_size == 0` |

## Security Considerations

- `require_auth()` is called on `owner` for upload, delete, and on `node` for registration.
- `require_admin` ensures only admin can pause/unpause.
- All loops bounded (`shard_count ≤ 64`, `redundancy_factor ≤ 5`) to avoid OOG.
- Checks-effects-interactions pattern: all storage updates happen before any external calls (none anyway) but before emitting events.
- Events emitted for every state change to enable off-chain tracking.
