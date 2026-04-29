// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, BytesN, Env};
use crate::types::{DataKey, InstanceKey, ShardInfo, FileMetadata, NodeInfo};

/// Returns whether the contract has been initialized.
pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

/// Returns the current admin address.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::Admin)
}

/// Sets the admin address.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

/// Returns the total file count.
pub fn get_file_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::FileCount)
        .unwrap_or(0)
}

/// Increments and returns the file count.
pub fn increment_file_count(env: &Env) -> u32 {
    let count = get_file_count(env);
    env.storage().instance().set(&InstanceKey::FileCount, &(count + 1));
    count + 1
}

/// Gets the file metadata by file_id.
pub fn get_file(env: &Env, file_id: &BytesN<32>) -> Option<FileMetadata> {
    env.storage()
        .persistent()
        .get(&DataKey::File(file_id.clone()))
}

/// Inserts file metadata into storage.
pub fn put_file(env: &Env, file_id: &BytesN<32>, metadata: &FileMetadata) {
    env.storage()
        .persistent()
        .set(&DataKey::File(file_id.clone()), metadata);
}

/// Removes file metadata from storage.
pub fn remove_file(env: &Env, file_id: &BytesN<32>) {
    env.storage()
        .persistent()
        .remove(&DataKey::File(file_id.clone()));
}

/// Returns true if the file exists.
pub fn has_file(env: &Env, file_id: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::File(file_id.clone()))
}

/// Gets shard info for a specific file and shard index.
pub fn get_shard(env: &Env, file_id: &BytesN<32>, shard_index: u32) -> Option<ShardInfo> {
    env.storage()
        .persistent()
        .get(&DataKey::Shard(file_id.clone(), shard_index))
}

/// Sets shard info.
pub fn put_shard(env: &Env, file_id: &BytesN<32>, shard_index: u32, shard: &ShardInfo) {
    env.storage()
        .persistent()
        .set(&DataKey::Shard(file_id.clone(), shard_index), shard);
}

/// Removes shard info.
pub fn remove_shard(env: &Env, file_id: &BytesN<32>, shard_index: u32) {
    env.storage()
        .persistent()
        .remove(&DataKey::Shard(file_id.clone(), shard_index));
}

/// Gets all file IDs registered to a specific storage node.
/// Returns a vector of BytesN<32> hashes.
pub fn get_node_files(env: &Env, node: &Address) -> Vec<BytesN<32>> {
    let key = DataKey::NodeFiles(node.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_default()
}

/// Appends a file ID to the node's registry.
pub fn add_node_file(env: &Env, node: &Address, file_id: BytesN<32>) {
    let mut files: Vec<BytesN<32>> = get_node_files(env, node);
    files.push(file_id);
    env.storage()
        .persistent()
        .set(&DataKey::NodeFiles(node.clone()), &files);
}

/// Removes a file ID from the node's registry.
pub fn remove_node_file(env: &Env, node: &Address, file_id: &BytesN<32>) {
    let mut files: Vec<BytesN<32>> = get_node_files(env, node);
    files.retain(|id| id != file_id);
    env.storage()
        .persistent()
        .set(&DataKey::NodeFiles(node.clone()), &files);
}

/// Returns the contract's paused state.
pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::IsPaused)
        .unwrap_or(false)
}

/// Sets the paused state.
pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::IsPaused, &paused);
}

/// Returns the current shard counter (for generating shard indices).
pub fn get_shard_counter(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::ShardCounter)
        .unwrap_or(0)
}

/// Increments the shard counter.
pub fn increment_shard_counter(env: &Env) -> u32 {
    let count = get_shard_counter(env);
    env.storage().instance().set(&InstanceKey::ShardCounter, &(count + 1));
    count + 1
}

// ── Node management ────────────────────────────────────────────────────────────

/// Gets node info if registered.
pub fn get_node(env: &Env, node: &Address) -> Option<NodeInfo> {
    env.storage()
        .persistent()
        .get(&DataKey::Node(node.clone()))
}

/// Sets node info.
pub fn put_node(env: &Env, node: &Address, info: &NodeInfo) {
    env.storage()
        .persistent()
        .set(&DataKey::Node(node.clone()), info);
}

/// Returns the number of registered nodes (for iteration/limits).
pub fn get_node_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::NodeCount)
        .unwrap_or(0)
}

/// Increments node count.
pub fn increment_node_count(env: &Env) -> u32 {
    let count = get_node_count(env);
    env.storage().instance().set(&InstanceKey::NodeCount, &(count + 1));
    count + 1
}

/// List all registered node addresses. Convenience for iteration.
pub fn list_nodes(env: &Env) -> Vec<Address> {
    // In a more advanced implementation, we might keep an index.
    // For simplicity, we'll iterate from 0..node_count and retrieve by index using a separate mapping.
    // But here we don't maintain index; we can store a NodeList key.
    // We'll cheat: we can store a Vec<Address> of all nodes.
    let key = DataKey::AllNodes;
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_default()
}

/// Add a node address to the global node registry.
pub fn add_node_address(env: &Env, node: Address) {
    let mut nodes: Vec<Address> = list_nodes(env);
    nodes.push(node);
    env.storage()
        .persistent()
        .set(&DataKey::AllNodes, &nodes);
}

/// Remove a node address from the global node registry.
pub fn remove_node_address(env: &Env, node: &Address) {
    let mut nodes: list_nodes(env);
    nodes.retain(|n| n != node);
    env.storage()
        .persistent()
        .set(&DataKey::AllNodes, &nodes);
}

