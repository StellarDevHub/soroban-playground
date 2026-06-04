// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

use crate::{AnalysisUtils, AnalysisUtilsClient, Error};
use crate::types::SeverityLevel;

fn setup() -> (Env, Address, AnalysisUtilsClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, AnalysisUtils);
    let client = AnalysisUtilsClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_initialize(&admin).unwrap_err().unwrap(),
        Error::AlreadyInitialized
    );
}

// ── security scan ─────────────────────────────────────────────────────────────

#[test]
fn test_record_security_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client
        .try_record_security(&admin, &hash(&env, 1), &SeverityLevel::High, &3)
        .unwrap()
        .unwrap();
    assert_eq!(id, 0);
    assert_eq!(client.get_security_count(), 1);
    let r = client.get_security_report(&0);
    assert_eq!(r.severity, SeverityLevel::High);
    assert_eq!(r.finding_count, 3);
}

#[test]
fn test_multiple_security_reports() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    client.try_record_security(&admin, &hash(&env, 1), &SeverityLevel::Low, &1).unwrap();
    client.try_record_security(&admin, &hash(&env, 2), &SeverityLevel::Critical, &5).unwrap();
    assert_eq!(client.get_security_count(), 2);
}

#[test]
fn test_security_report_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_security_report(&99).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

#[test]
fn test_non_admin_cannot_record_security() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client.try_record_security(&other, &hash(&env, 1), &SeverityLevel::None, &0).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

// ── gas analysis ──────────────────────────────────────────────────────────────

#[test]
fn test_record_gas_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client.try_record_gas(&admin, &hash(&env, 2), &1000u64, &5000u64, &80u32).unwrap().unwrap();
    assert_eq!(id, 0);
    let r = client.get_gas_report(&0);
    assert_eq!(r.avg_gas, 1000);
    assert_eq!(r.max_gas, 5000);
    assert_eq!(r.optimisation_score, 80);
}

#[test]
fn test_gas_score_over_100_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_record_gas(&admin, &hash(&env, 2), &100u64, &200u64, &101u32).unwrap_err().unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_gas_avg_greater_than_max_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_record_gas(&admin, &hash(&env, 2), &9000u64, &1000u64, &50u32).unwrap_err().unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_gas_report_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_gas_report(&0).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

// ── code quality ──────────────────────────────────────────────────────────────

#[test]
fn test_record_quality_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client.try_record_quality(&admin, &hash(&env, 3), &95u32, &2u32).unwrap().unwrap();
    assert_eq!(id, 0);
    let r = client.get_quality_report(&0);
    assert_eq!(r.score, 95);
    assert_eq!(r.warning_count, 2);
}

#[test]
fn test_quality_score_over_100_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_record_quality(&admin, &hash(&env, 3), &101u32, &0u32).unwrap_err().unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_quality_report_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_quality_report(&99).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

#[test]
fn test_non_admin_cannot_record_quality() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client.try_record_quality(&other, &hash(&env, 3), &90u32, &1u32).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

// ── property verification ─────────────────────────────────────────────────────

#[test]
fn test_record_verification_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client
        .try_record_verification(&admin, &hash(&env, 4), &s(&env, "no_reentrancy"), &true)
        .unwrap()
        .unwrap();
    assert_eq!(id, 0);
    let r = client.get_verification_result(&0);
    assert!(r.holds);
}

#[test]
fn test_record_verification_failing_property() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    client
        .try_record_verification(&admin, &hash(&env, 4), &s(&env, "balance_monotone"), &false)
        .unwrap();
    let r = client.get_verification_result(&0);
    assert!(!r.holds);
}

#[test]
fn test_record_verification_empty_property_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client
            .try_record_verification(&admin, &hash(&env, 4), &s(&env, ""), &true)
            .unwrap_err().unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_verification_result_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_verification_result(&0).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

#[test]
fn test_non_admin_cannot_record_verification() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client
            .try_record_verification(&other, &hash(&env, 4), &s(&env, "prop"), &true)
            .unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

// ── multi-report counts ───────────────────────────────────────────────────────

#[test]
fn test_all_counts_independent() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();

    client.try_record_security(&admin, &hash(&env, 1), &SeverityLevel::Info, &0).unwrap();
    client.try_record_security(&admin, &hash(&env, 2), &SeverityLevel::Low, &1).unwrap();

    client.try_record_gas(&admin, &hash(&env, 3), &500u64, &1000u64, &75u32).unwrap();

    client.try_record_quality(&admin, &hash(&env, 4), &88u32, &3u32).unwrap();
    client.try_record_quality(&admin, &hash(&env, 5), &72u32, &10u32).unwrap();
    client.try_record_quality(&admin, &hash(&env, 6), &55u32, &20u32).unwrap();

    client
        .try_record_verification(&admin, &hash(&env, 7), &s(&env, "safe"), &true)
        .unwrap();

    assert_eq!(client.get_security_count(), 2);
    assert_eq!(client.get_gas_count(), 1);
    assert_eq!(client.get_quality_count(), 3);
    assert_eq!(client.get_verification_count(), 1);
}

// ── pre-init guards ───────────────────────────────────────────────────────────

#[test]
fn test_record_before_init_fails() {
    let (env, admin, client) = setup();
    assert_eq!(
        client.try_record_security(&admin, &hash(&env, 0), &SeverityLevel::None, &0).unwrap_err().unwrap(),
        Error::NotInitialized
    );
}
