// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{BytesN, testutils::Address as _, Env, String};

fn make_hash(env: &Env, byte: u8) -> BytesN<32> {
    let arr = [byte; 32];
    BytesN::from_array(env, &arr)
}

#[test]
fn test_duplicate_hash_rejected() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let hash = make_hash(&env, 0xAA);
    let _ = client.file_patent(&inventor, &String::from_str(&env, "Patent A"), &String::from_str(&env, "Desc A"), &&99999999999u64, &hash);
    assert_eq!(
        client.try_file_patent(&inventor, &String::from_str(&env, "Patent B"), &String::from_str(&env, "Desc B"), &&99999999999u64, &hash),
        Err(Ok(Error::AlreadyExists))
    );
}

fn setup() -> (Env, Address, PatentRegistryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, PatentRegistryContract);
    let client = PatentRegistryContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn file_active_patent(env: &Env, client: &PatentRegistryContractClient<'static>, admin: &Address, inventor: &Address) -> u32 {
    let hash = make_hash(env, 0xAA);
    let id = client.file_patent(inventor, &String::from_str(env, "Test Patent"), &String::from_str(env, "A useful invention"), &(env.ledger().timestamp() + 86400 * 365), &hash);
    client.activate_patent(admin, &id);
    id
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    assert_eq!(client.try_initialize(&admin), Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_pause_unpause() {
    let (env, admin, client) = setup();
    assert!(!client.is_paused());
    client.pause(&admin);
    assert!(client.is_paused());
    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[test]
fn test_paused_blocks_file_patent() {
    let (env, admin, client) = setup();
    client.pause(&admin);
    let inventor = Address::generate(&env);
    let hash = make_hash(&env, 0x01);
    assert_eq!(
        client.try_file_patent(&inventor, &String::from_str(&env, "Title"), &String::from_str(&env, "Desc"), &&99999999999u64, &hash),
        Err(Ok(Error::Paused))
    );
}

#[test]
fn test_file_patent_returns_sequential_ids() {
    let (env, _admin, client) = setup();
    let inventor = Address::generate(&env);
    let hash1 = make_hash(&env, 0x01);
    let id1 = client.file_patent(&inventor, &String::from_str(&env, "Patent A"), &String::from_str(&env, "Desc A"), &&99999999999u64, &hash1);
    let hash2 = make_hash(&env, 0x02);
    let id2 = client.file_patent(&inventor, &String::from_str(&env, "Patent B"), &String::from_str(&env, "Desc B"), &&99999999999u64, &hash2);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_patent_count(), 2);
}

#[test]
fn test_file_patent_status_is_pending() {
    let (env, _admin, client) = setup();
    let inventor = Address::generate(&env);
    let hash = make_hash(&env, 0x04);
    let id = client.file_patent(&inventor, &String::from_str(&env, "Title"), &String::from_str(&env, "Desc"), &&99999999999u64, &hash);
    let patent = client.get_patent(&id);
    assert_eq!(patent.status, PatentStatus::Pending);
    assert_eq!(patent.owner, inventor);
}

#[test]
fn test_activate_patent() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let hash = make_hash(&env, 0x05);
    let id = client.file_patent(&inventor, &String::from_str(&env, "Title"), &String::from_str(&env, "Desc"), &&99999999999u64, &hash);
    client.activate_patent(&admin, &id);
    assert_eq!(client.get_patent(&id).status, PatentStatus::Active);
}

#[test]
fn test_activate_non_pending_fails() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    assert_eq!(client.try_activate_patent(&admin, &id), Err(Ok(Error::InvalidStatus)));
}

#[test]
fn test_transfer_patent() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    client.transfer_patent(&inventor, &id, &new_owner);
    assert_eq!(client.get_patent(&id).owner, new_owner);
}

#[test]
fn test_transfer_by_non_owner_fails() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let other = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    assert_eq!(client.try_transfer_patent(&other, &id, &other), Err(Ok(Error::NotOwner)));
}

#[test]
fn test_non_admin_cannot_activate() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let hash = make_hash(&env, 0x06);
    let id = client.file_patent(&inventor, &String::from_str(&env, "Title"), &String::from_str(&env, "Desc"), &&99999999999u64, &hash);
    let other = Address::generate(&env);
    assert_eq!(client.try_activate_patent(&other, &id), Err(Ok(Error::Unauthorized)));
    client.activate_patent(&admin, &id);
}

#[test]
fn test_revoke_patent() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    client.revoke_patent(&admin, &id);
    assert_eq!(client.get_patent(&id).status, PatentStatus::Revoked);
}
