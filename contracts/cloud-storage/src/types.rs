// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracttype, Address, BytesN, Vec};

/// Instance-level storage keys (single instance per contract).
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum InstanceKey {
    Admin = 1,
    FileCount = 2,
    ShardCounter = 3,
    IsPaused = 4,
    NodeCount = 5,
}

/// Persistent storage keys (per-entity).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum DataKey {
    /// File metadata by its SHA-256 file_id.
    File(BytesN<32>),
    /// Shard info for a specific file and shard index.
    Shard(BytesN<32>, u32),
    /// Set of file IDs registered to a node.
    NodeFiles(Address),
    /// Node capacity and usage information.
    Node(Address),
    /// List of all registered node addresses.
    AllNodes,
}

/// Metadata for a stored file.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct FileMetadata {
    /// Owner of the file.
    pub owner: Address,
    /// SHA-256 hash of the original file content.
    pub file_id: BytesN<32>,
    /// Total size in bytes.
    pub total_size: u64,
    /// Number of shards the file was split into.
    pub shard_count: u32,
    /// Redundancy factor (how many copies per shard).
    pub redundancy_factor: u32,
    /// List of shard information.
    pub shards: Vec<ShardInfo>,
    /// Ledger timestamp when the file was created.
    pub created_at: u64,
    /// Whether the contract is paused (snapshot at upload time for reference).
    pub is_paused: bool,
}

/// Information about a single shard.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ShardInfo {
    /// Index of the shard (0..shard_count-1).
    pub shard_index: u32,
    /// SHA-256 hash of this shard's content.
    pub shard_hash: BytesN<32>,
    /// List of storage node addresses holding this shard.
    pub nodes: Vec<Address>,
    /// Size of this shard in bytes.
    pub size_bytes: u64,
}

/// Information about a registered storage node.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct NodeInfo {
    /// Total capacity in bytes that this node has offered.
    pub capacity_bytes: u64,
    /// Currently used capacity in bytes.
    pub used_bytes: u64,
    /// Whether the node is active/healthy. Inactive nodes are ignored during rebalancing.
    pub is_active: bool,
}
