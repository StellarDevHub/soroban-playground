// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use crate::types::{ClaimStatus, Error};
use crate::{WarrantyManagement, WarrantyManagementClient};

fn setup() -> (Env, Address, WarrantyManagementClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, WarrantyManagement);
    let client = WarrantyManagementClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, WarrantyManagement);
    let client = WarrantyManagementClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    assert_eq!(client.try_initialize(&admin), Ok(Ok(())));
}

#[test]
fn test_initialize_twice_fails() {
    let (_, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ── Pause / Unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (_, admin, client) = setup();
    assert!(!client.is_paused());
    client.pause(&admin);
    assert!(client.is_paused());
    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_operations() {
    let (env, admin, client) = setup();
    client.pause(&admin);
    let manufacturer = Address::generate(&env);
    let result = client.try_register_product(
        &manufacturer,
        &String::from_str(&env, "Widget"),
        &31_536_000u64,
    );
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_unauthorized_pause() {
    let (env, _, client) = setup();
    let rando = Address::generate(&env);
    assert_eq!(client.try_pause(&rando), Err(Ok(Error::Unauthorized)));
}

// ── Product registration ──────────────────────────────────────────────────────

#[test]
fn test_register_product_ok() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    let id = client.register_product(
        &manufacturer,
        &String::from_str(&env, "Widget Pro"),
        &31_536_000u64,
    );
    assert_eq!(id, 1);
    let product = client.get_product(&id);
    assert_eq!(product.manufacturer, manufacturer);
    assert!(product.is_active);
}

#[test]
fn test_register_product_empty_name() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    assert_eq!(
        client.try_register_product(&manufacturer, &String::from_str(&env, ""), &31_536_000u64),
        Err(Ok(Error::EmptyName))
    );
}

#[test]
fn test_register_product_zero_duration() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    assert_eq!(
        client.try_register_product(&manufacturer, &String::from_str(&env, "Widget"), &0u64),
        Err(Ok(Error::InvalidDuration))
    );
}

#[test]
fn test_deactivate_product_by_manufacturer() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    let id = client.register_product(
        &manufacturer,
        &String::from_str(&env, "Widget"),
        &31_536_000u64,
    );
    client.deactivate_product(&manufacturer, &id);
    let product = client.get_product(&id);
    assert!(!product.is_active);
}

#[test]
fn test_deactivate_product_unauthorized() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    let rando = Address::generate(&env);
    let id = client.register_product(
        &manufacturer,
        &String::from_str(&env, "Widget"),
        &31_536_000u64,
    );
    assert_eq!(
        client.try_deactivate_product(&rando, &id),
        Err(Ok(Error::Unauthorized))
    );
}

// ── Warranty issuance ─────────────────────────────────────────────────────────

#[test]
fn test_issue_warranty_ok() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prod_id = client.register_product(
        &manufacturer,
        &String::from_str(&env, "Widget"),
        &31_536_000u64,
    );
    let war_id = client.issue_warranty(
        &manufacturer,
        &prod_id,
        &buyer,
        &String::from_str(&env, "SN-001"),
    );
    assert_eq!(war_id, 1);
    let warranty = client.get_warranty(&war_id);
    assert_eq!(warranty.owner, buyer);
    assert!(warranty.is_active);
}

#[test]
fn test_issue_warranty_inactive_product() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prod_id = client.register_product(
        &manufacturer,
        &String::from_str(&env, "Widget"),
        &31_536_000u64,
    );
    client.deactivate_product(&manufacturer, &prod_id);
    assert_eq!(
        client.try_issue_warranty(
            &manufacturer,
            &prod_id,
            &buyer,
            &String::from_str(&env, "SN-001")
        ),
        Err(Ok(Error::ProductInactive))
    );
}

#[test]
fn test_issue_warranty_unauthorized() {
    let (env, _, client) = setup();
    let manufacturer = Address::generate(&env);
    let rando = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prod_id = client.register_product(
        &manufacturer,
        &String::from_str(&env, "Widget"),
        &31_536_000u64,
    );
    assert_eq!(
        client.try_issue_warranty(&rando, &prod_id, &buyer, &String::from_str(&env, "SN-001")),
        Err(Ok(Error::Unauthorized))
    );
}

// ── Claim management ──────────────────────────────────────────────────────────

fn setup_with_warranty() -> (
    Env,
    Address,
    Address,
    u32,
    u32,
    WarrantyManagementClient<'static>,
) {
    let (env, _admin, client) = setup();
    let manufacturer = Address::generate(&env);
    let buyer = Address::generate(&env);
    let prod_id = client.register_product(
        &manufacturer,
        &String::from_str(&env, "Widget"),
        &31_536_000u64,
    );
    let war_id = client.issue_warranty(
        &manufacturer,
        &prod_id,
        &buyer,
        &String::from_str(&env, "SN-001"),
    );
    (env, manufacturer, buyer, prod_id, war_id, client)
}

#[test]
fn test_file_claim_ok() {
    let (env, _, buyer, _, war_id, client) = setup_with_warranty();
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Screen cracked"));
    assert_eq!(claim_id, 1);
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Filed);
}

#[test]
fn test_file_claim_at_exact_expiry_ok() {
    let (env, _, buyer, _, war_id, client) = setup_with_warranty();
    let warranty = client.get_warranty(&war_id);
    env.ledger().with_mut(|li| {
        li.timestamp = warranty.expiry_ts;
    });
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Last second"));
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Filed);
}

#[test]
fn test_file_claim_expired_rejected() {
    let (env, _, buyer, _, war_id, client) = setup_with_warranty();
    let warranty = client.get_warranty(&war_id);
    env.ledger().with_mut(|li| {
        li.timestamp = warranty.expiry_ts + 1;
    });
    assert_eq!(
        client.try_file_claim(&buyer, &war_id, &String::from_str(&env, "Too late")),
        Err(Ok(Error::WarrantyExpired))
    );
}

#[test]
fn test_file_claim_not_owner() {
    let (env, _, _, _, war_id, client) = setup_with_warranty();
    let rando = Address::generate(&env);
    assert_eq!(
        client.try_file_claim(&rando, &war_id, &String::from_str(&env, "Broken")),
        Err(Ok(Error::NotWarrantyOwner))
    );
}

#[test]
fn test_resolve_claim_approve() {
    let (env, manufacturer, buyer, _, war_id, client) = setup_with_warranty();
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Defective"));
    client.review_claim(&manufacturer, &claim_id);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::InReview);
    client.resolve_claim(&manufacturer, &claim_id, &true);
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Approved);
}

#[test]
fn test_resolve_claim_reject() {
    let (env, manufacturer, buyer, _, war_id, client) = setup_with_warranty();
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Defective"));
    client.review_claim(&manufacturer, &claim_id);
    client.resolve_claim(&manufacturer, &claim_id, &false);
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Rejected);
}

#[test]
fn test_resolve_claim_already_processed() {
    let (env, manufacturer, buyer, _, war_id, client) = setup_with_warranty();
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Defective"));
    client.review_claim(&manufacturer, &claim_id);
    client.resolve_claim(&manufacturer, &claim_id, &true);
    assert_eq!(
        client.try_resolve_claim(&manufacturer, &claim_id, &false),
        Err(Ok(Error::ClaimAlreadyProcessed))
    );
}

#[test]
fn test_resolve_claim_unauthorized() {
    let (env, manufacturer, buyer, _, war_id, client) = setup_with_warranty();
    let rando = Address::generate(&env);
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Defective"));
    assert_eq!(
        client.try_review_claim(&rando, &claim_id),
        Err(Ok(Error::Unauthorized))
    );
    client.review_claim(&manufacturer, &claim_id);
    assert_eq!(
        client.try_resolve_claim(&rando, &claim_id, &true),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn test_claim_lifecycle_full_replacement_voids_warranty() {
    let (env, manufacturer, buyer, _, war_id, client) = setup_with_warranty();
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Total failure"));
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Filed);

    client.review_claim(&manufacturer, &claim_id);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::InReview);

    client.resolve_claim(&manufacturer, &claim_id, &true);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Approved);

    client.reimburse_claim(&manufacturer, &claim_id, &true);
    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Reimbursed);

    // Warranty must be voided/burned after full product replacement
    let warranty = client.get_warranty(&war_id);
    assert!(!warranty.is_active);

    // Subsequent claims against the voided warranty must be rejected
    assert_eq!(
        client.try_file_claim(&buyer, &war_id, &String::from_str(&env, "Second claim")),
        Err(Ok(Error::WarrantyInactive))
    );
}

#[test]
fn test_claim_lifecycle_partial_reimbursement_keeps_warranty_active() {
    let (env, manufacturer, buyer, _, war_id, client) = setup_with_warranty();
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Minor repair"));
    client.review_claim(&manufacturer, &claim_id);
    client.resolve_claim(&manufacturer, &claim_id, &true);
    client.reimburse_claim(&manufacturer, &claim_id, &false);

    assert_eq!(client.get_claim(&claim_id).status, ClaimStatus::Reimbursed);
    assert!(client.get_warranty(&war_id).is_active);

    // Reimbursing again must fail
    assert_eq!(
        client.try_reimburse_claim(&manufacturer, &claim_id, &false),
        Err(Ok(Error::ClaimAlreadyProcessed))
    );
}

#[test]
fn test_invalid_claim_state_transitions() {
    let (env, manufacturer, buyer, _, war_id, client) = setup_with_warranty();
    let claim_id = client.file_claim(&buyer, &war_id, &String::from_str(&env, "Defect"));

    // Cannot resolve or reimburse directly from Filed
    assert_eq!(
        client.try_resolve_claim(&manufacturer, &claim_id, &true),
        Err(Ok(Error::InvalidClaimTransition))
    );
    assert_eq!(
        client.try_reimburse_claim(&manufacturer, &claim_id, &false),
        Err(Ok(Error::InvalidClaimTransition))
    );

    client.review_claim(&manufacturer, &claim_id);

    // Cannot review twice or reimburse while InReview
    assert_eq!(
        client.try_review_claim(&manufacturer, &claim_id),
        Err(Ok(Error::InvalidClaimTransition))
    );
    assert_eq!(
        client.try_reimburse_claim(&manufacturer, &claim_id, &false),
        Err(Ok(Error::InvalidClaimTransition))
    );

    // Reject claim; cannot reimburse a rejected claim
    client.resolve_claim(&manufacturer, &claim_id, &false);
    assert_eq!(
        client.try_reimburse_claim(&manufacturer, &claim_id, &true),
        Err(Ok(Error::InvalidClaimTransition))
    );
}

// ── Counters ──────────────────────────────────────────────────────────────────

#[test]
fn test_counters() {
    let (env, _, buyer, _, war_id, client) = setup_with_warranty();
    assert_eq!(client.product_count(), 1);
    assert_eq!(client.warranty_count(), 1);
    client.file_claim(&buyer, &war_id, &String::from_str(&env, "Broken"));
    assert_eq!(client.claim_count(), 1);
}
