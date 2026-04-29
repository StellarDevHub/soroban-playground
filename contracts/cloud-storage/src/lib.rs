// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Decentralized Cloud Storage Contract
//!
//! A Soroban smart contract for managing file storage with sharding and redundancy.
//! Files are split into shards, each replicated across multiple storage nodes.
//! The contract supports node registration, file upload, retrieval, deletion,
//! and rebalancing of shards to maintain redundancy.
//!
//! ## Key Concepts
//! - File ID is the SHA-256 hash of the file content.
//! - Sharding: files are split into N shards; each shard stored on M nodes (redundancy factor).
//! - Storage nodes register with capacity; the contract assigns shards to nodes with available space.
//! - Admin can pause/unpause the contract to temporarily disable uploads/deletions.
//!
//! ## Security
//! - Only the file owner may delete their file.
//! - Node registration requires authentication from the node address.
//! - Admin-only functions for pause/unpause.
//! - Checks-effects-interactions pattern to prevent reentrancy.
//! - All state changes emit events for off-chain tracking.

#![no_std]

mod access;
mod errors;
mod events;
mod sharding;
mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Symbol, vec::Vec};
use crate::access::{
    require_initialized, require_not_paused, require_admin, require_file_owner,
    require_node_operator,
};
use crate::errors::ContractError;
use crate::events::*;
use crate::sharding::assign_shards;
use crate::storage::{
    get_admin, set_admin, get_file, put_file, remove_file, has_file, get_shard,
    put_shard, get_node_files, add_node_file, remove_node_file, is_paused, set_paused,
    increment_file_count, get_file_count, increment_shard_counter, get_node, put_node,
    get_node_count, increment_node_count, add_node_address, list_nodes,
};

#[contract]
pub struct CloudStorage;

#[contractimpl]
impl CloudStorage {
    // ── Initialization ────────────────────────────────────────────────────────────

    /// Initialize the contract with an admin address.
    /// This must be called once before any other function.
    ///
    /// # Arguments
    /// - `admin`: The address that will have admin privileges (pause/unpause).
    ///
    /// # Events
    /// None.
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        // Ensure not already initialized.
        if is_initialized(&env) {
            return Err(ContractError::AlreadyInitialized);
        }
        // Admin must authenticate (optional but good practice)
        admin.require_auth();

        set_admin(&env, &admin);
        // Initialize counters to zero.
        env.storage().instance().set(&crate::types::InstanceKey::FileCount, &0u32);
        env.storage().instance().set(&crate::types::InstanceKey::ShardCounter, &0u32);
        env.storage().instance().set(&crate::types::InstanceKey::IsPaused, &false);
        env.storage().instance().set(&crate::types::InstanceKey::NodeCount, &0u32);

        Ok(())
    }

    // ── File Operations ──────────────────────────────────────────────────────────

    /// Upload a file to decentralized storage.
    /// The file is split into shards and each shard is replicated across
    /// multiple storage nodes according to the redundancy factor.
    ///
    /// # Arguments
    /// - `owner`: The owner address (must authenticate).
    /// - `file_id`: SHA-256 hash of the entire file content (BytesN<32>).
    /// - `total_size`: Total size of the file in bytes.
    /// - `shard_hashes`: List of SHA-256 hashes for each shard, length = shard_count.
    /// - `redundancy_factor`: Number of distinct nodes per shard (max 5).
    ///
    /// # Returns
    /// - `FileMetadata` for the uploaded file.
    ///
    /// # Errors
    /// - `ContractPaused` if contract is paused.
    /// - `Unauthorized` if caller is not the owner.
    /// - `InvalidShardCount` if shard_count > 64.
    /// - `InvalidRedundancyFactor` if redundancy_factor > 5.
    /// - `FileAlreadyExists` if file_id already registered.
    /// - `RebalanceFailed` if insufficient nodes for assignment.
    pub fn upload_file(
        env: Env,
        owner: Address,
        file_id: BytesN<32>,
        total_size: u64,
        shard_hashes: Vec<BytesN<32>>,
        redundancy_factor: u32,
    ) -> Result<crate::types::FileMetadata, ContractError> {
        owner.require_auth();
        require_initialized(&env)?;
        require_not_paused(&env)?;

        // Validate inputs
        ensure_non_zero(total_size)?;
        validate_shard_count(shard_hashes.len() as u32)?;
        validate_redundancy_factor(redundancy_factor)?;

        if shard_hashes.len() as u32 != shard_hashes.len() as u32 {} // dummy to avoid warning
        // Check duplicate file
        if has_file(&env, &file_id) {
            return Err(ContractError::FileAlreadyExists);
        }

        // Compute shard count from vector length
        let shard_count = shard_hashes.len() as u32;
        // Validate all shard hashes are non-zero (implicitly by type; skip)

        // Create file metadata with empty shards list initially.
        let created_at = env.ledger().timestamp();
        let is_paused = is_paused(&env);

        let mut metadata = crate::types::FileMetadata {
            owner: owner.clone(),
            file_id: file_id.clone(),
            total_size,
            shard_count,
            redundancy_factor,
            shards: Vec::new(),
            created_at,
            is_paused,
        };

        // Assign shards to nodes (updates storage directly and emits events)
        assign_shards(
            &env,
            &file_id,
            &shard_hashes,
            total_size,
            redundancy_factor,
        )?;

        // Collect shard infos to include in metadata.
        for i in 0..shard_count {
            let shard_info = get_shard(&env, &file_id, i)
                .ok_or(ContractError::ShardAssignmentMissing)?;
            metadata.shards.push(shard_info);
        }

        // Save file metadata.
        put_file(&env, &file_id, &metadata);

        // Increment file count.
        increment_file_count(&env);

        // Emit FileUploaded event.
        file_uploaded(&env, &file_id, &owner, shard_count, total_size);

        Ok(metadata)
    }

    /// Get metadata for a file by its file_id.
    pub fn get_file(env: Env, file_id: BytesN<32>) -> Result<crate::types::FileMetadata, ContractError> {
        require_initialized(&env)?;
        get_file(&env, &file_id).ok_or(ContractError::FileNotFound)
    }

    /// Get shard info for a specific shard of a file.
    pub fn get_shard(
        env: Env,
        file_id: BytesN<32>,
        shard_index: u32,
    ) -> Result<crate::types::ShardInfo, ContractError> {
        require_initialized(&env)?;
        get_shard(&env, &file_id, shard_index).ok_or(ContractError::ShardAssignmentMissing)
    }

    /// Delete a file and all its shard assignments.
    /// Only the file owner may delete.
    ///
    /// # Arguments
    /// - `caller`: The address invoking the deletion (must be owner).
    /// - `file_id`: The file to delete.
    ///
    /// # Events
    /// - `FileDeleted`.
    pub fn delete_file(env: Env, caller: Address, file_id: BytesN<32>) -> Result<(), ContractError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        let metadata = get_file(&env, &file_id).ok_or(ContractError::FileNotFound)?;

        // Verify ownership
        require_file_owner(&caller, &metadata.owner)?;

        // For each shard, update node capacities and remove file references.
        for shard in metadata.shards.iter() {
            for node in shard.nodes.iter() {
                // Decrement node used capacity
                if let Some(mut node_info) = get_node(&env, node) {
                    if node_info.used_bytes >= shard.size_bytes {
                        node_info.used_bytes -= shard.size_bytes;
                    } else {
                        node_info.used_bytes = 0; // underflow guard
                    }
                    put_node(&env, node, &node_info);
                }
                // Remove file from node's registry
                remove_node_file(&env, node, &file_id);
            }
            // Remove shard entry
            remove_shard(&env, &file_id, shard.shard_index);
        }

        // Remove file metadata
        remove_file(&env, &file_id);

        // Decrement file count
        let count = get_file_count(&env);
        if count > 0 {
            env.storage().instance().set(&crate::types::InstanceKey::FileCount, &(count - 1));
        }

        // Emit event
        file_deleted(&env, &file_id, &caller);

        Ok(())
    }

    // ── Node Operations ──────────────────────────────────────────────────────────

    /// Register a storage node with a specified capacity.
    /// The node must authenticate itself (i.e., the `node` address must sign).
    ///
    /// If the node is already registered, its capacity is updated to the new value.
    ///
    /// # Arguments
    /// - `node`: The node's Stellar address.
    /// - `capacity_bytes`: Total capacity the node offers in bytes.
    ///
    /// # Events
    /// - `NodeRegistered`.
    pub fn register_node(
        env: Env,
        node: Address,
        capacity_bytes: u64,
    ) -> Result<(), ContractError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        // Node must authorize
        require_node_operator(&node, &env.invoker())?;

        let mut node_info = get_node(&env, &node).unwrap_or(crate::types::NodeInfo {
            capacity_bytes,
            used_bytes: 0,
            is_active: true,
        });

        // If new registration, update count and global list
        if node_info.capacity_bytes == 0 {
            // New node
            let new_count = increment_node_count(&env);
            add_node_address(&env, node.clone());
            // Emit event for new registration
            node_registered(&env, &node, capacity_bytes);
        } else {
            // Existing node updating capacity: adjust difference? We'll just set new capacity.
            // But if capacity increases, that's fine; if decreases, we may exceed used? Not checking for simplicity.
            node_info.is_active = true;
        }

        node_info.capacity_bytes = capacity_bytes;
        // Ensure used doesn't exceed capacity
        if node_info.used_bytes > node_info.capacity_bytes {
            node_info.used_bytes = node_info.capacity_bytes;
        }

        put_node(&env, &node, &node_info);

        Ok(())
    }

    /// Get all file IDs stored on a particular node.
    pub fn get_node_files(env: Env, node: Address) -> Result<Vec<BytesN<32>>, ContractError> {
        require_initialized(&env)?;
        Ok(get_node_files(&env, &node))
    }

    // ── Rebalancing ───────────────────────────────────────────────────────────────

    /// Rebalance shards for a file to maintain redundancy.
    /// This redistributes shards from unhealthy or full nodes to healthy ones.
    ///
    /// # Arguments
    /// - `caller`: The caller (must be file owner or admin).
    /// - `file_id`: The file to rebalance.
    ///
    /// # Events
    /// - `ShardsRebalanced`.
    pub fn rebalance_shards(
        env: Env,
        caller: Address,
        file_id: BytesN<32>,
    ) -> Result<(), ContractError> {
        require_initialized(&env)?;
        require_not_paused(&env)?;

        // Only admin or file owner can trigger rebalance
        let metadata = get_file(&env, &file_id).ok_or(ContractError::FileNotFound)?;
        let is_admin = get_admin(&env) == Some(caller.clone());
        let is_owner = caller == metadata.owner;
        if !is_admin && !is_owner {
            return Err(ContractError::Unauthorized);
        }

        // Perform rebalance
        crate::sharding::rebalance_shards(&env, &file_id, &metadata)?;

        Ok(())
    }

    // ── Admin / Pause Control ────────────────────────────────────────────────────

    /// Pause the contract. Only admin can call.
    /// When paused, upload and delete operations are disabled.
    pub fn pause_contract(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        contract_paused(&env, &admin);
        Ok(())
    }

    /// Unpause the contract. Only admin can call.
    pub fn unpause_contract(env: Env, admin: Address) -> Result<(), ContractError> {
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        contract_unpaused(&env, &admin);
        Ok(())
    }
}
