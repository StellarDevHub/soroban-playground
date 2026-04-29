// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, BugBountyContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);

    (env, admin, contract_id, client)
}

fn setup_with_token() -> (
    Env,
    Address,
    Address,
    BugBountyContractClient<'static>,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);

    (env, admin, contract_id, client, token_id)
}

fn mint_tokens(env: &Env, token_id: &Address, recipient: &Address, amount: i128) {
    StellarAssetClient::new(env, token_id).mint(recipient, &amount);
}

fn token_balance(env: &Env, token_id: &Address, addr: &Address) -> i128 {
    TokenClient::new(env, token_id).balance(addr)
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);
    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.pool_balance(), 0);
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);
    let result = client.try_initialize(&admin, &None, &None, &None, &None);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Pool funding ──────────────────────────────────────────────────────────────

#[test]
fn test_fund_pool() {
    let (env, admin, contract_id, client, token_id) = setup_with_token();
    client.initialize(&admin, &None, &None, &None, &None);

    let funder = Address::generate(&env);
    mint_tokens(&env, &token_id, &funder, 500_000_000);

    client.fund_pool(&funder, &token_id, &500_000_000);

    assert_eq!(client.pool_balance(), 500_000_000);
    assert_eq!(token_balance(&env, &token_id, &contract_id), 500_000_000);
}

// ── Report submission ─────────────────────────────────────────────────────────

#[test]
fn test_submit_report_ok() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let reporter = Address::generate(&env);
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Reentrancy in withdraw"),
        &String::from_str(&env, "QmXyz123"),
        &Severity::High,
    );

    assert_eq!(id, 1);
    assert_eq!(client.report_count(), 1);
    assert!(client.has_open_report(&reporter));

    let report = client.get_report(&1);
    assert_eq!(report.status, ReportStatus::Pending);
    assert_eq!(report.severity, Severity::High);
    assert_eq!(report.reporter, reporter);
}

#[test]
fn test_submit_report_empty_title_fails() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let reporter = Address::generate(&env);
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, ""),
        &String::from_str(&env, "QmXyz123"),
        &Severity::Low,
    );
    assert_eq!(result, Err(Ok(Error::EmptyTitle)));
}

#[test]
fn test_submit_duplicate_open_report_fails() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let reporter = Address::generate(&env);
    client.submit_report(
        &reporter,
        &String::from_str(&env, "Bug 1"),
        &String::from_str(&env, "QmA"),
        &Severity::Low,
    );

    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, "Bug 2"),
        &String::from_str(&env, "QmB"),
        &Severity::Medium,
    );
    assert_eq!(result, Err(Ok(Error::AlreadyHasOpenReport)));
}

// ── Triage ────────────────────────────────────────────────────────────────────

#[test]
fn test_full_triage_and_claim() {
    let (env, admin, contract_id, client, token_id) = setup_with_token();
    client.initialize(&admin, &None, &None, &None, &None);

    // Fund pool.
    let funder = Address::generate(&env);
    mint_tokens(&env, &token_id, &funder, 1_000_000_000);
    client.fund_pool(&funder, &token_id, &1_000_000_000);

    // Submit report.
    let reporter = Address::generate(&env);
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Critical overflow"),
        &String::from_str(&env, "QmCritical"),
        &Severity::Critical,
    );

    // Start review.
    client.start_review(&admin, &id);
    assert_eq!(client.get_report(&id).status, ReportStatus::UnderReview);

    // Accept with default reward.
    client.accept_report(&admin, &id, &None);
    let report = client.get_report(&id);
    assert_eq!(report.status, ReportStatus::Accepted);
    assert_eq!(report.reward_amount, 1_000_000_000); // default Critical reward

    // Pool balance reduced.
    assert_eq!(client.pool_balance(), 0);

    // Claim reward.
    let payout = client.claim_reward(&reporter, &id, &token_id);
    assert_eq!(payout, 1_000_000_000);
    assert_eq!(token_balance(&env, &token_id, &reporter), 1_000_000_000);

    let paid_report = client.get_report(&id);
    assert_eq!(paid_report.status, ReportStatus::Paid);
    assert!(!client.has_open_report(&reporter));
}

#[test]
fn test_reject_report() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let reporter = Address::generate(&env);
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Duplicate"),
        &String::from_str(&env, "QmDup"),
        &Severity::Low,
    );

    client.reject_report(&admin, &id);
    assert_eq!(client.get_report(&id).status, ReportStatus::Rejected);
    // Reporter can now submit again.
    assert!(!client.has_open_report(&reporter));
}

#[test]
fn test_accept_insufficient_pool_fails() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let reporter = Address::generate(&env);
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Critical bug"),
        &String::from_str(&env, "QmC"),
        &Severity::Critical,
    );

    // Pool is empty — accept should fail.
    let result = client.try_accept_report(&admin, &id, &None);
    assert_eq!(result, Err(Ok(Error::InsufficientPool)));
}

// ── Pause / emergency ─────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_submission() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    client.set_paused(&admin, &true);
    assert!(client.is_paused());

    let reporter = Address::generate(&env);
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, "Bug"),
        &String::from_str(&env, "QmX"),
        &Severity::Low,
    );
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_unpause_allows_submission() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    client.set_paused(&admin, &true);
    client.set_paused(&admin, &false);
    assert!(!client.is_paused());

    let reporter = Address::generate(&env);
    client.submit_report(
        &reporter,
        &String::from_str(&env, "Bug"),
        &String::from_str(&env, "QmX"),
        &Severity::Low,
    );
}

#[test]
fn test_emergency_withdraw() {
    let (env, admin, contract_id, client, token_id) = setup_with_token();
    client.initialize(&admin, &None, &None, &None, &None);

    let funder = Address::generate(&env);
    mint_tokens(&env, &token_id, &funder, 200_000_000);
    client.fund_pool(&funder, &token_id, &200_000_000);

    client.emergency_withdraw(&admin, &token_id, &200_000_000);

    assert_eq!(client.pool_balance(), 0);
    assert_eq!(token_balance(&env, &token_id, &admin), 200_000_000);
}

// ── Reward tiers ──────────────────────────────────────────────────────────────

#[test]
fn test_custom_reward_tiers() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(
        &admin,
        &Some(5_000_000),
        &Some(25_000_000),
        &Some(100_000_000),
        &Some(500_000_000),
    );

    assert_eq!(client.reward_for_severity(&Severity::Low), 5_000_000);
    assert_eq!(client.reward_for_severity(&Severity::Medium), 25_000_000);
    assert_eq!(client.reward_for_severity(&Severity::High), 100_000_000);
    assert_eq!(client.reward_for_severity(&Severity::Critical), 500_000_000);
}

#[test]
fn test_set_reward_tier() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    client.set_reward_tier(&admin, &Severity::High, &300_000_000);
    assert_eq!(client.reward_for_severity(&Severity::High), 300_000_000);
}

// ── Access control ────────────────────────────────────────────────────────────

#[test]
fn test_non_admin_cannot_accept() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let reporter = Address::generate(&env);
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Bug"),
        &String::from_str(&env, "QmX"),
        &Severity::Low,
    );

    let impostor = Address::generate(&env);
    let result = client.try_accept_report(&impostor, &id, &None);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_transfer_admin() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let new_admin = Address::generate(&env);
    client.transfer_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

// ── Withdraw report ───────────────────────────────────────────────────────────

#[test]
fn test_withdraw_report() {
    let (env, admin, _contract_id, client) = setup();
    client.initialize(&admin, &None, &None, &None, &None);

    let reporter = Address::generate(&env);
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Oops"),
        &String::from_str(&env, "QmOops"),
        &Severity::Low,
    );

    client.withdraw_report(&reporter, &id);
    assert_eq!(client.get_report(&id).status, ReportStatus::Withdrawn);
    assert!(!client.has_open_report(&reporter));
}

// ── Custom reward override ────────────────────────────────────────────────────

#[test]
fn test_accept_with_custom_reward() {
    let (env, admin, _contract_id, client, token_id) = setup_with_token();
    client.initialize(&admin, &None, &None, &None, &None);

    let funder = Address::generate(&env);
    mint_tokens(&env, &token_id, &funder, 500_000_000);
    client.fund_pool(&funder, &token_id, &500_000_000);

    let reporter = Address::generate(&env);
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Medium bug"),
        &String::from_str(&env, "QmMed"),
        &Severity::Medium,
    );

    // Override with a custom reward of 30 XLM.
    client.accept_report(&admin, &id, &Some(300_000_000));
    assert_eq!(client.get_report(&id).reward_amount, 300_000_000);
    assert_eq!(client.pool_balance(), 200_000_000);
}
