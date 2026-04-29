// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{Env, Address, BytesN, vec::Vec};
use cloud_storage::{CloudStorage, CloudStorageClient};

/// Helper to create a dummy BytesN<32> filled with a pattern.
/// Not a cryptographic hash; used only for testing structure.
fn dummy_hash(byte: u8) -> BytesN<32> {
    let mut arr = [byte; 32];
    BytesN::from_array(&arr)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, CloudStorage);
    let client = CloudStorageClient::new(&env, &contract_id);

    // Initialize
    client.initialize(&admin);
    assert_eq!(client.get_admin().unwrap(), admin);
}

#[test]
fn test_upload_file_happy_path() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let node1 = Address::generate(&env);
    let node2 = Address::generate(&env);
    let node3 = Address::generate(&env);

    let contract_id = env.register_contract(None, CloudStorage);
    let mut client = CloudStorageClient::new(&env, &contract_id);

    // Initialize contract
    client.initialize(&admin);

    // Register three storage nodes, each with 1MB capacity
    client.register_node(&node1, &1_048_576);
    client.register_node(&node2, &1_048_576);
    client.register_node(&node3, &1_048_576);

    // Prepare a file: 1MB file, 4 shards, redundancy 2
    let total_size = 1_048_576u64;
    let shard_hashes: Vec<BytesN<32>> = vec![
        dummy_hash(0),
        dummy_hash(1),
        dummy_hash(2),
        dummy_hash(3),
    ];
    let file_id = dummy_hash(9);

    // Upload file
    let metadata = client.upload_file(
        &owner,
        &file_id,
        &total_size,
        &shard_hashes,
        &2,
    );

    assert!(metadata.is_ok());
    let meta = metadata.unwrap();
    assert_eq!(meta.owner, owner);
    assert_eq!(meta.total_size, total_size);
    assert_eq!(meta.shard_count, 4);
    assert_eq!(meta.redundancy_factor, 2);
    assert_eq!(meta.shards.len(), 4);
    for (i, shard) in meta.shards.iter().enumerate() {
        assert_eq!(shard.shard_index, i as u32);
        assert_eq!(shard.nodes.len(), 2);
        assert_eq!(shard.size_bytes, total_size / 4);
    }
}

#[test]
fn test_delete_file_by_owner() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let node = Address::generate(&env);

    let contract_id = env.register_contract(None, CloudStorage);
    let mut client = CloudStorageClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.register_node(&node, &1_048_576);

    let total_size = 1024u64;
    let shard_hashes = vec![dummy_hash(0)];
    let file_id = dummy_hash(9);

    // Upload as owner
    client.upload_file(&owner, &file_id, &total_size, &shard_hashes, &1);

    // Delete as owner
    let delete_result = client.delete_file(&owner, &file_id);
    assert!(delete_result.is_ok());

    // File should be gone
    let get_result = client.get_file(&file_id);
    assert!(get_result.unwrap_err().to_string().contains("FileNotFound"));
}

#[test]
fn test_delete_file_by_non_owner() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    let node = Address::generate(&env);

    let contract_id = env.register_contract(None, CloudStorage);
    let mut client = CloudStorageClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.register_node(&node, &1_048_576);

    let total_size = 1024u64;
    let shard_hashes = vec![dummy_hash(0)];
    let file_id = dummy_hash(9);

    client.upload_file(&owner, &file_id, &total_size, &shard_hashes, &1);

    // Attacker tries to delete
    let delete_result = client.delete_file(&attacker, &file_id);
    assert!(delete_result.is_err());
}

#[test]
fn test_pause_then_upload_fails() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let node = Address::generate(&env);

    let contract_id = env.register_contract(None, CloudStorage);
    let mut client = CloudStorageClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.register_node(&node, &1_048_576);

    // Pause contract
    client.pause_contract(&admin);

    let total_size = 1024u64;
    let shard_hashes = vec![dummy_hash(0)];
    let file_id = dummy_hash(9);

    let result = client.upload_file(&owner, &file_id, &total_size, &shard_hashes, &1);
    assert!(result.unwrap_err().to_string().contains("ContractPaused"));
}

#[test]
fn test_rebalance_shards() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let node1 = Address::generate(&env);
    let node2 = Address::generate(&env);
    let node3 = Address::generate(&env);

    let contract_id = env.register_contract(None, CloudStorage);
    let mut client = CloudStorageClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.register_node(&node1, &1_048_576);
    client.register_node(&node2, &1_048_576);
    client.register_node(&node3, &1_048_576);

    // Upload with redundancy 2
    let total_size = 2048u64;
    let shard_hashes = vec![dummy_hash(0), dummy_hash(1)];
    let file_id = dummy_hash(9);
    client.upload_file(&owner, &file_id, &total_size, &shard_hashes, &2);

    // Rebalance should be no-op
    let rebalance_result = client.rebalance_shards(&owner, &file_id);
    assert!(rebalance_result.is_ok());
}

#[test]
fn test_get_node_files() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let node = Address::generate(&env);

    let contract_id = env.register_contract(None, CloudStorage);
    let mut client = CloudStorageClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.register_node(&node, &1_048_576);

    let total_size = 1024u64;
    let shard_hashes = vec![dummy_hash(0)];
    let file_id = dummy_hash(9);
    client.upload_file(&owner, &file_id, &total_size, &shard_hashes, &1);

    let files = client.get_node_files(&node);
    assert!(files.is_ok());
    let files_vec = files.unwrap();
    assert_eq!(files_vec.len(), 1);
    assert_eq!(files_vec[0], file_id);
}
