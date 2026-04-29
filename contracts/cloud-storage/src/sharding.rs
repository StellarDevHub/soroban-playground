// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, BytesN, Env, Vec};
use crate::types::{DataKey, NodeInfo, ShardInfo};
use crate::storage::{get_node, put_node, get_node_files, add_node_file, remove_node_file};
use crate::events::{shard_assigned, ContractError};

/// Attempts to assign a shard to a node.
/// Returns true if assignment succeeded, false if node lacked capacity or already assigned.
fn try_assign_shard(
    env: &Env,
    file_id: &BytesN<32>,
    shard_index: u32,
    shard_hash: &BytesN<32>,
    shard_size: u64,
    node: &Address,
) -> Result<bool, ContractError> {
    // Check if node already assigned to this shard
    if let Some(shard) = get_shard(env, file_id, shard_index) {
        if shard.nodes.contains(node) {
            return Ok(false);
        }
    }

    let mut node_info = get_node(env, node)
        .ok_or(ContractError::NodeNotFound)?;

    if !node_info.is_active {
        return Ok(false);
    }

    let free = node_info.capacity_bytes - node_info.used_bytes;
    if free < shard_size {
        return Ok(false);
    }

    // Deduct capacity
    node_info.used_bytes += shard_size;
    put_node(env, node, &node_info);

    // Update shard info
    let mut shard = get_shard(env, file_id, shard_index)
        .unwrap_or(ShardInfo {
            shard_index,
            shard_hash: shard_hash.clone(),
            nodes: Vec::new(),
            size_bytes: shard_size,
        });
    shard.nodes.push(node.clone());
    put_shard(env, file_id, shard_index, &shard);

    // Link file to node.
    add_node_file(env, node, file_id.clone());

    // Emit event.
    shard_assigned(env, file_id, shard_index, node);

    Ok(true)
}

    let free = node_info.capacity_bytes - node_info.used_bytes;
    if free < shard_size {
        return Ok(false);
    }

    // Assign shard to node.
    node_info.used_bytes += shard_size;
    put_node(env, node, &node_info);

     // Record assignment in shard storage.
     let mut shard = get_shard(env, file_id, shard_index)
         .unwrap_or(ShardInfo {
             shard_index,
             shard_hash: shard_hash.clone(),
             nodes: Vec::new(),
             size_bytes: shard_size,
         });
     // Avoid duplicate assignment of same node to this shard
     if !shard.nodes.contains(node) {
         shard.nodes.push(node.clone());
     } else {
         // Node already assigned; we still deduct capacity? That would be double counting.
         // Since we already deducted capacity above, we should revert deduction and return false.
         // Revert capacity
         node_info.used_bytes = node_info.used_bytes.saturating_sub(shard_size);
         put_node(env, node, &node_info);
         return Ok(false);
     }
     put_shard(env, file_id, shard_index, &shard);

    // Link file to node.
    add_node_file(env, node, file_id.clone());

    // Emit event.
    shard_assigned(env, file_id, shard_index, node);

    Ok(true)
}

/// Assigns shards for a new file upload.
/// For each shard, picks `redundancy_factor` distinct nodes with enough capacity.
/// Returns an error if assignment fails due to insufficient nodes.
pub fn assign_shards(
    env: &Env,
    file_id: &BytesN<32>,
    shard_hashes: &[BytesN<32>],
    total_size: u64,
    redundancy_factor: u32,
) -> Result<(), ContractError> {
    let shard_count = shard_hashes.len() as u32;
    if shard_count == 0 {
        return Err(ContractError::InvalidShardCount);
    }

    // Compute per-shard size (evenly). Last shard may be larger due to remainder.
    let base_size = total_size / shard_count;
    let mut remainder = total_size % shard_count;

    // Iterate all nodes once to attempt assignments for all shards.
    // We'll do multiple passes if needed to reach redundancy for each shard.
    for (idx, shard_hash) in shard_hashes.iter().enumerate() {
        let shard_index = idx as u32;
        let mut shard_size = base_size;
        if remainder > 0 {
            shard_size += 1;
            remainder -= 1;
        }

        let mut assigned_count = 0;
        let mut node_iter = list_nodes(env).into_iter();

        while assigned_count < redundancy_factor {
            match node_iter.next() {
                Some(node) => {
                    match try_assign_shard(env, file_id, shard_index, &shard_hash, shard_size, &node) {
                        Ok(true) => {
                            assigned_count += 1;
                        }
                        Ok(false) => continue, // node full or inactive, try next
                        Err(e) => return Err(e),
                    }
                }
                None => break, // no more nodes
            }
        }

        if assigned_count < redundancy_factor {
            return Err(ContractError::RebalanceFailed);
        }
    }

    Ok(())
}

/// Rebalances shards for a given file.
/// Ensures each shard has at least `redundancy_factor` copies on active nodes.
/// If a node is missing (perhaps removed), finds new nodes to compensate.
/// If too many nodes are unavailable, may fail.
pub fn rebalance_shards(
    env: &Env,
    file_id: &BytesN<32>,
    file_metadata: &crate::types::FileMetadata,
) -> Result<(), ContractError> {
    let shard_count = file_metadata.shard_count;
    let redundancy = file_metadata.redundancy_factor;

    // For each shard, ensure redundancy.
    for shard_index in 0..shard_count {
        let shard = get_shard(env, file_id, shard_index)
            .ok_or(ContractError::ShardAssignmentMissing)?;

        let current_count = shard.nodes.len() as u32;
        if current_count >= redundancy {
            // Already sufficient.
            continue;
        }

        let needed = redundancy - current_count;
        let shard_size = shard.size_bytes;
        let shard_hash = &shard.shard_hash;

        // Find replacement nodes.
        let mut assigned = 0;
        for node in list_nodes(env).into_iter() {
            // Skip nodes that already hold this shard.
            if shard.nodes.contains(&node) {
                continue;
            }
            match try_assign_shard(env, file_id, shard_index, shard_hash, shard_size, &node) {
                Ok(true) => {
                    assigned += 1;
                    if assigned == needed { break; }
                }
                Ok(false) => continue,
                Err(e) => return Err(e),
            }
        }

        if assigned < needed {
            return Err(ContractError::RebalanceFailed);
        }
    }

    // Emit rebalance event.
    crate::events::shards_rebalanced(env, file_id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
}
