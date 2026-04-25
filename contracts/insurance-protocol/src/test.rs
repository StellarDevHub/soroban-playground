// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, InsuranceProtocolClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, InsuranceProtocol);
    let client = InsuranceProtocolClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn add_product(
    env: &Env,
    client: &InsuranceProtocolClient,
    admin: &Address,
) -> u32 {
    client.list_product(
        admin,
        &String::from_str(env, "Smart Contract Cover"),
        &1_000_000,   // premium
        &50_000_000,  // coverage
        &30,          // risk score
    )
}

fn buy_and_claim(
    env: &Env,
    client: &InsuranceProtocolClient,
    admin: &Address,
) -> (Address, u32, u32) {
    let product_id = add_product(env, client, admin);
    let holder = Address::generate(env);
    let policy_id = client.buy_policy(&holder, &product_id);
    let claim_id = client.file_claim(
        &holder,
        &policy_id,
        &String::from_str(env, "Contract exploited"),
    );
    (holder, policy_id, claim_id)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── list_product ──────────────────────────────────────────────────────────────

#[test]
fn test_list_product_stores_data() {
    let (env, admin, client) = setup();
    let id = add_product(&env, &client, &admin);
    let p = client.get_product(&id);
    assert_eq!(p.risk_score, 30);
    assert_eq!(p.premium, 1_000_000);
    assert!(p.is_active);
}

#[test]
fn test_list_product_sequential_ids() {
    let (env, admin, client) = setup();
    let id1 = add_product(&env, &client, &admin);
    let id2 = add_product(&env, &client, &admin);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_list_product_empty_name_fails() {
    let (env, admin, client) = setup();
    let result = client.try_list_product(
        &admin,
        &String::from_str(&env, ""),
        &1_000_000,
        &50_000_000,
        &30,
    );
    assert_eq!(result, Err(Ok(Error::EmptyName)));
}

#[test]
fn test_list_product_zero_premium_fails() {
    let (env, admin, client) = setup();
    let result = client.try_list_product(
        &admin,
        &String::from_str(&env, "Cover"),
        &0,
        &50_000_000,
        &30,
    );
    assert_eq!(result, Err(Ok(Error::ZeroPremium)));
}

#[test]
fn test_list_product_zero_coverage_fails() {
    let (env, admin, client) = setup();
    let result = client.try_list_product(
        &admin,
        &String::from_str(&env, "Cover"),
        &1_000_000,
        &0,
        &30,
    );
    assert_eq!(result, Err(Ok(Error::ZeroCoverage)));
}

#[test]
fn test_list_product_invalid_risk_score_fails() {
    let (env, admin, client) = setup();
    let result = client.try_list_product(
        &admin,
        &String::from_str(&env, "Cover"),
        &1_000_000,
        &50_000_000,
        &101,
    );
    assert_eq!(result, Err(Ok(Error::InvalidRiskScore)));
}

#[test]
fn test_list_product_non_admin_fails() {
    let (env, _admin, client) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_list_product(
        &stranger,
        &String::from_str(&env, "Cover"),
        &1_000_000,
        &50_000_000,
        &30,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── deactivate_product ────────────────────────────────────────────────────────

#[test]
fn test_deactivate_product() {
    let (env, admin, client) = setup();
    let id = add_product(&env, &client, &admin);
    client.deactivate_product(&admin, &id);
    assert!(!client.get_product(&id).is_active);
}

#[test]
fn test_buy_policy_on_inactive_product_fails() {
    let (env, admin, client) = setup();
    let id = add_product(&env, &client, &admin);
    client.deactivate_product(&admin, &id);
    let user = Address::generate(&env);
    let result = client.try_buy_policy(&user, &id);
    assert_eq!(result, Err(Ok(Error::PolicyInactive)));
}

// ── buy_policy ────────────────────────────────────────────────────────────────

#[test]
fn test_buy_policy_stores_data() {
    let (env, admin, client) = setup();
    let product_id = add_product(&env, &client, &admin);
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    let policy = client.get_policy(&policy_id);
    assert_eq!(policy.holder, holder);
    assert_eq!(policy.product_id, product_id);
    assert!(policy.is_active);
    assert!(policy.expiry_ts > policy.start_ts);
}

#[test]
fn test_buy_policy_sequential_ids() {
    let (env, admin, client) = setup();
    let product_id = add_product(&env, &client, &admin);
    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let id1 = client.buy_policy(&u1, &product_id);
    let id2 = client.buy_policy(&u2, &product_id);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

// ── file_claim ────────────────────────────────────────────────────────────────

#[test]
fn test_file_claim_stores_data() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.status, ClaimStatus::Pending);
    assert_eq!(claim.votes_for, 0);
    assert_eq!(claim.votes_against, 0);
}

#[test]
fn test_file_claim_non_holder_fails() {
    let (env, admin, client) = setup();
    let product_id = add_product(&env, &client, &admin);
    let holder = Address::generate(&env);
    let stranger = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    let result = client.try_file_claim(
        &stranger,
        &policy_id,
        &String::from_str(&env, "fraud"),
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_file_claim_expired_policy_fails() {
    let (env, admin, client) = setup();
    let product_id = add_product(&env, &client, &admin);
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    // Advance past expiry
    env.ledger().with_mut(|l| l.timestamp += POLICY_TERM_SECS + 1);
    let result = client.try_file_claim(
        &holder,
        &policy_id,
        &String::from_str(&env, "late claim"),
    );
    assert_eq!(result, Err(Ok(Error::PolicyInactive)));
}

// ── vote_claim ────────────────────────────────────────────────────────────────

#[test]
fn test_vote_increments_counts() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    let v1 = Address::generate(&env);
    let v2 = Address::generate(&env);
    client.vote_claim(&v1, &claim_id, &true);
    client.vote_claim(&v2, &claim_id, &false);
    let claim = client.get_claim(&claim_id);
    assert_eq!(claim.votes_for, 1);
    assert_eq!(claim.votes_against, 1);
}

#[test]
fn test_double_vote_fails() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    let voter = Address::generate(&env);
    client.vote_claim(&voter, &claim_id, &true);
    let result = client.try_vote_claim(&voter, &claim_id, &true);
    assert_eq!(result, Err(Ok(Error::AlreadyVoted)));
}

#[test]
fn test_vote_on_finalised_claim_fails() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    // Cast enough votes
    for _ in 0..3 {
        let v = Address::generate(&env);
        client.vote_claim(&v, &claim_id, &true);
    }
    // Advance past voting window
    env.ledger().with_mut(|l| l.timestamp += VOTING_WINDOW_SECS + 1);
    client.finalise_claim(&claim_id);

    let voter = Address::generate(&env);
    let result = client.try_vote_claim(&voter, &claim_id, &true);
    assert_eq!(result, Err(Ok(Error::ClaimNotVotable)));
}

// ── finalise_claim ────────────────────────────────────────────────────────────

#[test]
fn test_finalise_claim_approved() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    for _ in 0..3 {
        let v = Address::generate(&env);
        client.vote_claim(&v, &claim_id, &true);
    }
    env.ledger().with_mut(|l| l.timestamp += VOTING_WINDOW_SECS + 1);
    let status = client.finalise_claim(&claim_id);
    assert_eq!(status, ClaimStatus::Approved);
}

#[test]
fn test_finalise_claim_rejected() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    for _ in 0..3 {
        let v = Address::generate(&env);
        client.vote_claim(&v, &claim_id, &false);
    }
    env.ledger().with_mut(|l| l.timestamp += VOTING_WINDOW_SECS + 1);
    let status = client.finalise_claim(&claim_id);
    assert_eq!(status, ClaimStatus::Rejected);
}

#[test]
fn test_finalise_before_voting_ends_fails() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    for _ in 0..3 {
        let v = Address::generate(&env);
        client.vote_claim(&v, &claim_id, &true);
    }
    // Do NOT advance time
    let result = client.try_finalise_claim(&claim_id);
    assert_eq!(result, Err(Ok(Error::VotingPeriodActive)));
}

#[test]
fn test_finalise_insufficient_votes_fails() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    // Only 2 votes (below MIN_VOTES = 3)
    for _ in 0..2 {
        let v = Address::generate(&env);
        client.vote_claim(&v, &claim_id, &true);
    }
    env.ledger().with_mut(|l| l.timestamp += VOTING_WINDOW_SECS + 1);
    let result = client.try_finalise_claim(&claim_id);
    assert_eq!(result, Err(Ok(Error::InsufficientVotes)));
}

#[test]
fn test_finalise_twice_fails() {
    let (env, admin, client) = setup();
    let (_holder, _policy_id, claim_id) = buy_and_claim(&env, &client, &admin);
    for _ in 0..3 {
        let v = Address::generate(&env);
        client.vote_claim(&v, &claim_id, &true);
    }
    env.ledger().with_mut(|l| l.timestamp += VOTING_WINDOW_SECS + 1);
    client.finalise_claim(&claim_id);
    let result = client.try_finalise_claim(&claim_id);
    assert_eq!(result, Err(Ok(Error::ClaimAlreadyFinalised)));
}

// ── counters ──────────────────────────────────────────────────────────────────

#[test]
fn test_counters_increment() {
    let (env, admin, client) = setup();
    assert_eq!(client.product_count(), 0);
    add_product(&env, &client, &admin);
    assert_eq!(client.product_count(), 1);
    assert_eq!(client.policy_count(), 0);
    let holder = Address::generate(&env);
    client.buy_policy(&holder, &1);
    assert_eq!(client.policy_count(), 1);
}
