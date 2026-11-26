// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

fn setup() -> (Env, BugBountyContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    client.initialize(&admin, &1_000_000_000i128);
    (env, client, admin, reporter)
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, _reporter) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, _reporter) = setup();
    let result = client.try_initialize(&admin, &0i128);
    assert!(result.is_err());
}

#[test]
fn test_submit_report_success() {
    let (env, client, _admin, reporter) = setup();
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "SQL Injection"),
        &String::from_str(&env, "QmHash123"),
        &Severity::High,
    );
    assert_eq!(id, 1);
    assert_eq!(client.report_count(), 1);
}

#[test]
fn test_submit_report_empty_title_fails() {
    let (env, client, _admin, reporter) = setup();
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, ""),
        &String::from_str(&env, "QmHash123"),
        &Severity::Low,
    );
    assert!(result.is_err());
}

#[test]
fn test_submit_report_empty_hash_fails() {
    let (env, client, _admin, reporter) = setup();
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, "Title"),
        &String::from_str(&env, ""),
        &Severity::Low,
    );
    assert!(result.is_err());
}

#[test]
fn test_duplicate_open_report_fails() {
    let (env, client, _admin, reporter) = setup();
    client.submit_report(
        &reporter,
        &String::from_str(&env, "Bug 1"),
        &String::from_str(&env, "hash1"),
        &Severity::Low,
    );
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, "Bug 2"),
        &String::from_str(&env, "hash2"),
        &Severity::Low,
    );
    assert!(result.is_err());
}

#[test]
fn test_full_lifecycle() {
    let (env, client, admin, reporter) = setup();
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "RCE"),
        &String::from_str(&env, "QmRCE"),
        &Severity::Critical,
    );

    client.start_review(&admin, &id);
    let report = client.get_report(&id);
    assert_eq!(report.status, ReportStatus::UnderReview);

    let reward = client.accept_report(&admin, &id);
    assert!(reward > 0);

    let report = client.get_report(&id);
    assert_eq!(report.status, ReportStatus::Accepted);
    assert_eq!(report.reward_amount, reward);

    client.mark_paid(&admin, &id);
    let report = client.get_report(&id);
    assert_eq!(report.status, ReportStatus::Paid);
}

#[test]
fn test_reject_report() {
    let (env, client, admin, reporter) = setup();
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Dupe"),
        &String::from_str(&env, "QmDupe"),
        &Severity::Low,
    );

    client.reject_report(&admin, &id);
    let report = client.get_report(&id);
    assert_eq!(report.status, ReportStatus::Rejected);
}

#[test]
fn test_withdraw_report() {
    let (env, client, _admin, reporter) = setup();
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Withdraw me"),
        &String::from_str(&env, "QmW"),
        &Severity::Medium,
    );

    client.withdraw_report(&reporter, &id);
    let report = client.get_report(&id);
    assert_eq!(report.status, ReportStatus::Withdrawn);
}

#[test]
fn test_paused_blocks_submission() {
    let (env, client, admin, reporter) = setup();
    client.set_paused(&admin, &true);
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, "Bug"),
        &String::from_str(&env, "hash"),
        &Severity::Low,
    );
    assert!(result.is_err());
}

#[test]
fn test_unauthorized_admin_fails() {
    let (_env, client, _admin, reporter) = setup();
    let result = client.try_set_paused(&reporter, &true);
    assert!(result.is_err());
}

#[test]
fn test_insufficient_pool_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);
    // Initialize with zero pool
    client.initialize(&admin, &0i128);

    // The tier is escrowed at submission, so an empty pool can no longer take a
    // report it could not pay: it is refused up front instead of at acceptance.
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, "Critical"),
        &String::from_str(&env, "hash"),
        &Severity::Critical,
    );
    assert_eq!(result, Err(Ok(Error::InsufficientPool)));
    assert_eq!(client.report_count(), 0);
    assert_eq!(client.locked_balance(), 0);
    let _ = admin;
}

#[test]
fn test_report_not_found() {
    let (_env, client, _admin, _reporter) = setup();
    let result = client.try_get_report(&999u32);
    assert!(result.is_err());
}

#[test]
fn test_fund_pool_increases_balance() {
    let (_env, client, admin, _reporter) = setup();
    let before = client.pool_balance();
    client.fund_pool(&admin, &500_000_000i128);
    assert_eq!(client.pool_balance(), before + 500_000_000);
}

// ── Enhanced error handling tests ─────────────────────────────────────────────

#[test]
fn test_initialize_negative_pool_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let result = client.try_initialize(&admin, &(-1i128));
    assert!(result.is_err());
}

#[test]
fn test_fund_pool_zero_fails() {
    let (_env, client, admin, _reporter) = setup();
    let result = client.try_fund_pool(&admin, &0i128);
    assert!(result.is_err());
}

#[test]
fn test_fund_pool_negative_fails() {
    let (_env, client, admin, _reporter) = setup();
    let result = client.try_fund_pool(&admin, &(-1i128));
    assert!(result.is_err());
}

#[test]
fn test_submit_report_title_too_long_fails() {
    let (env, client, _admin, reporter) = setup();
    // 129 characters
    let long_title = String::from_str(
        &env,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    let result = client.try_submit_report(
        &reporter,
        &long_title,
        &String::from_str(&env, "QmHash"),
        &Severity::Low,
    );
    assert!(result.is_err());
}

#[test]
fn test_submit_report_description_hash_too_long_fails() {
    let (env, client, _admin, reporter) = setup();
    // 257 characters
    let long_hash = String::from_str(
        &env,
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    let result = client.try_submit_report(
        &reporter,
        &String::from_str(&env, "Valid Title"),
        &long_hash,
        &Severity::Low,
    );
    assert!(result.is_err());
}

#[test]
fn test_set_reward_zero_fails() {
    let (_env, client, admin, _reporter) = setup();
    let result = client.try_set_reward(&admin, &Severity::Low, &0i128);
    assert!(result.is_err());
}

#[test]
fn test_set_reward_too_large_fails() {
    let (_env, client, admin, _reporter) = setup();
    // 100_000_000_001 stroops > 10 000 XLM cap
    let result = client.try_set_reward(&admin, &Severity::Critical, &100_000_000_001i128);
    assert!(result.is_err());
}

#[test]
fn test_set_reward_at_cap_succeeds() {
    let (_env, client, admin, _reporter) = setup();
    // exactly 10 000 XLM cap should pass
    client.set_reward(&admin, &Severity::High, &100_000_000_000i128);
    assert_eq!(
        client.reward_for_severity(&Severity::High),
        100_000_000_000i128
    );
}

#[test]
fn test_mark_paid_non_accepted_fails() {
    let (env, client, admin, reporter) = setup();
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Test"),
        &String::from_str(&env, "QmTest"),
        &Severity::Low,
    );
    // report is Pending, not Accepted → mark_paid should fail
    let result = client.try_mark_paid(&admin, &id);
    assert!(result.is_err());
}

#[test]
fn test_start_review_on_non_pending_fails() {
    let (env, client, admin, reporter) = setup();
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Test2"),
        &String::from_str(&env, "QmTest2"),
        &Severity::Medium,
    );
    client.start_review(&admin, &id);
    // already UnderReview → start_review again should fail
    let result = client.try_start_review(&admin, &id);
    assert!(result.is_err());
}

#[test]
fn test_accept_report_on_pending_fails() {
    let (env, client, admin, reporter) = setup();
    let id = client.submit_report(
        &reporter,
        &String::from_str(&env, "Test3"),
        &String::from_str(&env, "QmTest3"),
        &Severity::Low,
    );
    // still Pending, not UnderReview
    let result = client.try_accept_report(&admin, &id);
    assert!(result.is_err());
}
