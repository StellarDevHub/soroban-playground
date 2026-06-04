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
    client.initialize(&admin, &1_000_000_000i128).unwrap();
    (env, client, admin, reporter)
}

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, _reporter) = setup();
    assert_eq!(client.get_admin().unwrap(), admin);
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
    let id = client
        .submit_report(
            &reporter,
            &String::from_str(&env, "SQL Injection"),
            &String::from_str(&env, "QmHash123"),
            &Severity::High,
        )
        .unwrap();
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
    client
        .submit_report(
            &reporter,
            &String::from_str(&env, "Bug 1"),
            &String::from_str(&env, "hash1"),
            &Severity::Low,
        )
        .unwrap();
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
    let id = client
        .submit_report(
            &reporter,
            &String::from_str(&env, "RCE"),
            &String::from_str(&env, "QmRCE"),
            &Severity::Critical,
        )
        .unwrap();

    client.start_review(&admin, &id).unwrap();
    let report = client.get_report(&id).unwrap();
    assert_eq!(report.status, ReportStatus::UnderReview);

    let reward = client.accept_report(&admin, &id).unwrap();
    assert!(reward > 0);

    let report = client.get_report(&id).unwrap();
    assert_eq!(report.status, ReportStatus::Accepted);
    assert_eq!(report.reward_amount, reward);

    client.mark_paid(&admin, &id).unwrap();
    let report = client.get_report(&id).unwrap();
    assert_eq!(report.status, ReportStatus::Paid);
}

#[test]
fn test_reject_report() {
    let (env, client, admin, reporter) = setup();
    let id = client
        .submit_report(
            &reporter,
            &String::from_str(&env, "Dupe"),
            &String::from_str(&env, "QmDupe"),
            &Severity::Low,
        )
        .unwrap();

    client.reject_report(&admin, &id).unwrap();
    let report = client.get_report(&id).unwrap();
    assert_eq!(report.status, ReportStatus::Rejected);
}

#[test]
fn test_withdraw_report() {
    let (env, client, _admin, reporter) = setup();
    let id = client
        .submit_report(
            &reporter,
            &String::from_str(&env, "Withdraw me"),
            &String::from_str(&env, "QmW"),
            &Severity::Medium,
        )
        .unwrap();

    client.withdraw_report(&reporter, &id).unwrap();
    let report = client.get_report(&id).unwrap();
    assert_eq!(report.status, ReportStatus::Withdrawn);
}

#[test]
fn test_paused_blocks_submission() {
    let (env, client, admin, reporter) = setup();
    client.set_paused(&admin, &true).unwrap();
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
    let (env, client, _admin, reporter) = setup();
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
    client.initialize(&admin, &0i128).unwrap();

    let id = client
        .submit_report(
            &reporter,
            &String::from_str(&env, "Critical"),
            &String::from_str(&env, "hash"),
            &Severity::Critical,
        )
        .unwrap();
    client.start_review(&admin, &id).unwrap();
    let result = client.try_accept_report(&admin, &id);
    assert!(result.is_err());
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
    client.fund_pool(&admin, &500_000_000i128).unwrap();
    assert_eq!(client.pool_balance(), before + 500_000_000);
}
