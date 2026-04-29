// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, Address};

/// Custom error codes for the Cloud Storage contract.
/// All error variants are `#[repr(u32)]` to ensure stable error codes on-chain.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// The contract has not been initialized.
    NotInitialized = 1,
    /// The contract is currently paused.
    ContractPaused = 2,
    /// The caller is not authorized to perform this action.
    Unauthorized = 3,
    /// The specified file does not exist.
    FileNotFound = 4,
    /// The file already exists (duplicate file_id).
    FileAlreadyExists = 5,
    /// The file owner does not match the caller.
    NotFileOwner = 6,
    /// Shard count exceeds the maximum allowed (64).
    InvalidShardCount = 7,
    /// Redundancy factor exceeds the maximum allowed (5).
    InvalidRedundancyFactor = 8,
    /// Number of shard hashes does not match shard count.
    ShardCountMismatch = 9,
    /// A shard hash is zero/empty.
    EmptyShardHash = 10,
    /// The specified storage node does not exist.
    NodeNotFound = 11,
    /// The node has insufficient capacity for the shard.
    InsufficientNodeCapacity = 12,
    /// Attempt to delete a non-existent shard assignment.
    ShardAssignmentMissing = 13,
    /// Rebalancing failed due to unhealthy nodes.
    RebalanceFailed = 14,
    /// Invalid total size (zero).
    InvalidTotalSize = 15,
    /// Invalid parameters provided.
    InvalidParameters = 16,
}

/// Ensures the contract is initialized.
pub fn ensure_initialized(initialized: bool) -> Result<(), ContractError> {
    if !initialized {
        Err(ContractError::NotInitialized)
    } else {
        Ok(())
    }
}

/// Ensures the contract is not paused.
pub fn ensure_not_paused(paused: bool) -> Result<(), ContractError> {
    if paused {
        Err(ContractError::ContractPaused)
    } else {
        Ok(())
    }
}

/// Ensures the caller is the file owner.
pub fn ensure_owner(caller: &Address, owner: &Address) -> Result<(), ContractError> {
    if caller != owner {
        Err(ContractError::Unauthorized)
    } else {
        Ok(())
    }
}

/// Validates shard count (max 64).
pub fn validate_shard_count(count: u32) -> Result<(), ContractError> {
    if count == 0 || count > 64 {
        Err(ContractError::InvalidShardCount)
    } else {
        Ok(())
    }
}

/// Validates redundancy factor (max 5).
pub fn validate_redundancy_factor(factor: u32) -> Result<(), ContractError> {
    if factor == 0 || factor > 5 {
        Err(ContractError::InvalidRedundancyFactor)
    } else {
        Ok(())
    }
}

/// Ensures a value is non-zero.
pub fn ensure_non_zero(value: u64) -> Result<(), ContractError> {
    if value == 0 {
        Err(ContractError::InvalidTotalSize)
    } else {
        Ok(())
    }
}
