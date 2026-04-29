// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, BytesN, Env};

/// FileUploaded: Emitted when a new file is uploaded and registered.
/// Topics: (symbol, file_id, owner, shard_count, total_size)
pub fn file_uploaded(e: &Env, file_id: &BytesN<32>, owner: &Address, shard_count: u32, total_size: u64) {
    e.events().publish(
        (symbol_short!("file_uploaded"),),
        (
            file_id,
            owner,
            shard_count,
            total_size,
        ),
    );
}

/// ShardAssigned: Emitted when a shard is assigned to a storage node.
/// Topics: (symbol, file_id, shard_index, node)
pub fn shard_assigned(e: &Env, file_id: &BytesN<32>, shard_index: u32, node: &Address) {
    e.events().publish(
        (symbol_short!("shard_assigned"),),
        (
            file_id,
            shard_index,
            node,
        ),
    );
}

/// NodeRegistered: Emitted when a new storage node registers with capacity.
/// Topics: (symbol, node, capacity_bytes)
pub fn node_registered(e: &Env, node: &Address, capacity_bytes: u64) {
    e.events().publish(
        (symbol_short!("node_registered"),),
        (
            node,
            capacity_bytes,
        ),
    );
}

/// FileDeleted: Emitted when a file is deleted by its owner or admin.
/// Topics: (symbol, file_id, caller)
pub fn file_deleted(e: &Env, file_id: &BytesN<32>, caller: &Address) {
    e.events().publish(
        (symbol_short!("file_deleted"),),
        (
            file_id,
            caller,
        ),
    );
}

/// ShardsRebalanced: Emitted when shards are redistributed across healthy nodes.
/// Topics: (symbol, file_id)
pub fn shards_rebalanced(e: &Env, file_id: &BytesN<32>) {
    e.events().publish(
        (symbol_short!("shards_rebalanced"),),
        (file_id,),
    );
}

/// ContractPaused: Emitted when the contract is paused by an admin.
/// Topics: (symbol, admin)
pub fn contract_paused(e: &Env, admin: &Address) {
    e.events().publish(
        (symbol_short!("contract_paused"),),
        (admin,),
    );
}

/// ContractUnpaused: Emitted when the contract is unpaused by an admin.
/// Topics: (symbol, admin)
pub fn contract_unpaused(e: &Env, admin: &Address) {
    e.events().publish(
        (symbol_short!("contract_unpaused"),),
        (admin,),
    );
}

// Helper for symbol_short
use soroban_sdk::symbol_short;
