// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};
use crate::{WarrantyContract, WarrantyContractClient};
use crate::types::ClaimStatus;

fn setup() -> (Env, Address, WarrantyContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, WarrantyContract);
    let client = WarrantyContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    assert!(client.is_initialized());
    assert!(!client.is_paused());
}

#[test]
#[should_panic]
fn test_double_init_fails() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
fn test_register_product() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mfr = Address::generate(&env);
    let id = client.register_product(
        &admin,
        &String::from_str(&env, "Laptop X1"),
        &mfr,
        &(365 * 24 * 3600),
    );
    assert_eq!(id, 1);
    assert_eq!(client.product_count(), 1);
    let p = client.get_product(&1);
    assert!(p.is_active);
}

#[test]
fn test_issue_warranty_and_check_validity() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mfr = Address::generate(&env);
    let pid = client.register_product(&admin, &String::from_str(&env, "Phone"), &mfr, &(365 * 24 * 3600));
    let owner = Address::generate(&env);
    let wid = client.issue_warranty(&admin, &pid, &owner);
    assert_eq!(wid, 1);
    assert!(client.is_warranty_valid(&wid));
}

#[test]
fn test_file_and_approve_claim() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mfr = Address::generate(&env);
    let pid = client.register_product(&admin, &String::from_str(&env, "TV"), &mfr, &(365 * 24 * 3600));
    let owner = Address::generate(&env);
    let wid = client.issue_warranty(&admin, &pid, &owner);
    let cid = client.file_claim(&owner, &wid, &String::from_str(&env, "Screen cracked"));
    assert_eq!(cid, 1);
    let claim = client.get_claim(&cid);
    assert_eq!(claim.status, ClaimStatus::Pending);
    client.process_claim(&admin, &cid, &true);
    let claim2 = client.get_claim(&cid);
    assert_eq!(claim2.status, ClaimStatus::Approved);
}

#[test]
fn test_reject_claim() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mfr = Address::generate(&env);
    let pid = client.register_product(&admin, &String::from_str(&env, "Watch"), &mfr, &(365 * 24 * 3600));
    let owner = Address::generate(&env);
    let wid = client.issue_warranty(&admin, &pid, &owner);
    let cid = client.file_claim(&owner, &wid, &String::from_str(&env, "Water damage"));
    client.process_claim(&admin, &cid, &false);
    assert_eq!(client.get_claim(&cid).status, ClaimStatus::Rejected);
}

#[test]
fn test_expired_warranty_blocks_claim() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mfr = Address::generate(&env);
    // 1 second warranty
    let pid = client.register_product(&admin, &String::from_str(&env, "Gadget"), &mfr, &1);
    let owner = Address::generate(&env);
    let wid = client.issue_warranty(&admin, &pid, &owner);
    // Advance time past expiry
    env.ledger().with_mut(|l| l.timestamp += 10);
    assert!(!client.is_warranty_valid(&wid));
    assert!(client.try_file_claim(&owner, &wid, &String::from_str(&env, "Broken")).is_err());
}

#[test]
fn test_pause_blocks_claims() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mfr = Address::generate(&env);
    let pid = client.register_product(&admin, &String::from_str(&env, "Camera"), &mfr, &(365 * 24 * 3600));
    let owner = Address::generate(&env);
    let wid = client.issue_warranty(&admin, &pid, &owner);
    client.pause(&admin);
    assert!(client.try_file_claim(&owner, &wid, &String::from_str(&env, "Lens issue")).is_err());
    client.unpause(&admin);
    assert!(client.file_claim(&owner, &wid, &String::from_str(&env, "Lens issue")) > 0);
}

#[test]
fn test_double_process_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mfr = Address::generate(&env);
    let pid = client.register_product(&admin, &String::from_str(&env, "Tablet"), &mfr, &(365 * 24 * 3600));
    let owner = Address::generate(&env);
    let wid = client.issue_warranty(&admin, &pid, &owner);
    let cid = client.file_claim(&owner, &wid, &String::from_str(&env, "Battery issue"));
    client.process_claim(&admin, &cid, &true);
    assert!(client.try_process_claim(&admin, &cid, &false).is_err());
}
