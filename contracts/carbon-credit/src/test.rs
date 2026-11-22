// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, CarbonCreditContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

fn make_issuer(env: &Env, client: &CarbonCreditContractClient<'_>, admin: &Address) -> Address {
    let issuer = Address::generate(env);
    client.register_issuer(&issuer, &String::from_str(env, "EcoCorp"));
    client.verify_issuer(admin, &issuer);
    issuer
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_double_initialize_fails() {
    let (_env, client, admin) = setup();
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Issuer management ─────────────────────────────────────────────────────────

#[test]
fn test_register_issuer() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    client.register_issuer(&issuer, &String::from_str(&env, "GreenCo"));
    let info = client.get_issuer_info(&issuer);
    assert_eq!(info.verified, false);
    assert_eq!(info.total_minted, 0);
}

#[test]
fn test_register_duplicate_issuer_fails() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    client.register_issuer(&issuer, &String::from_str(&env, "GreenCo"));
    let result = client.try_register_issuer(&issuer, &String::from_str(&env, "GreenCo2"));
    assert_eq!(result, Err(Ok(Error::IssuerAlreadyRegistered)));
}

#[test]
fn test_verify_issuer() {
    let (env, client, admin) = setup();
    let issuer = Address::generate(&env);
    client.register_issuer(&issuer, &String::from_str(&env, "EcoCorp"));
    client.verify_issuer(&admin, &issuer);
    let info = client.get_issuer_info(&issuer);
    assert!(info.verified);
}

#[test]
fn test_verify_nonexistent_issuer_fails() {
    let (env, client, admin) = setup();
    let issuer = Address::generate(&env);
    let result = client.try_verify_issuer(&admin, &issuer);
    assert_eq!(result, Err(Ok(Error::IssuerNotFound)));
}

#[test]
fn test_verify_issuer_unauthorized_fails() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    let impostor = Address::generate(&env);
    client.register_issuer(&issuer, &String::from_str(&env, "EcoCorp"));
    let result = client.try_verify_issuer(&impostor, &issuer);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Minting ───────────────────────────────────────────────────────────────────

#[test]
fn test_mint_increases_balance_and_supply() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);

    client.mint(&issuer, &holder, &1000);
    assert_eq!(client.get_balance(&holder), 1000);
    assert_eq!(client.total_supply(), 1000);

    let info = client.get_issuer_info(&issuer);
    assert_eq!(info.total_minted, 1000);
}

#[test]
fn test_mint_unverified_issuer_fails() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    client.register_issuer(&issuer, &String::from_str(&env, "DirtyCorp"));
    let holder = Address::generate(&env);
    let result = client.try_mint(&issuer, &holder, &100);
    assert_eq!(result, Err(Ok(Error::IssuerNotVerified)));
}

#[test]
fn test_mint_unregistered_issuer_fails() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    let holder = Address::generate(&env);
    let result = client.try_mint(&issuer, &holder, &100);
    assert_eq!(result, Err(Ok(Error::IssuerNotFound)));
}

#[test]
fn test_mint_zero_amount_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    let result = client.try_mint(&issuer, &holder, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

// ── Transfer ──────────────────────────────────────────────────────────────────

#[test]
fn test_transfer() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint(&issuer, &alice, &1000);
    client.transfer(&alice, &bob, &400);

    assert_eq!(client.get_balance(&alice), 600);
    assert_eq!(client.get_balance(&bob), 400);
    assert_eq!(client.total_supply(), 1000); // unchanged
}

#[test]
fn test_transfer_insufficient_balance_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.mint(&issuer, &alice, &100);
    let result = client.try_transfer(&alice, &bob, &200);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_transfer_zero_amount_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.mint(&issuer, &alice, &100);
    let result = client.try_transfer(&alice, &bob, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

// ── Retirement ledger ─────────────────────────────────────────────────────────

#[test]
fn test_retire_creates_immutable_record() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let id = client.retire(&holder, &300, &String::from_str(&env, "QmProjectHash123"));
    assert_eq!(id, 1);

    let record = client.get_retirement(&1);
    assert_eq!(record.id, 1);
    assert_eq!(record.retiree, holder);
    assert_eq!(record.amount, 300);

    assert_eq!(client.get_balance(&holder), 700);
    assert_eq!(client.total_supply(), 700);
    assert_eq!(client.total_retired(), 300);
    assert_eq!(client.retirement_count(), 1);
}

#[test]
fn test_multiple_retirements_distinct_records() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let id1 = client.retire(&holder, &100, &String::from_str(&env, "Qm1"));
    let id2 = client.retire(&holder, &200, &String::from_str(&env, "Qm2"));

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_retirement(&1).amount, 100);
    assert_eq!(client.get_retirement(&2).amount, 200);
    assert_eq!(client.total_retired(), 300);
    assert_eq!(client.retirement_count(), 2);
}

#[test]
fn test_retire_insufficient_balance_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &100);
    let result = client.try_retire(&holder, &500, &String::from_str(&env, "Qm"));
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_retire_zero_amount_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &100);
    let result = client.try_retire(&holder, &0, &String::from_str(&env, "Qm"));
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_retirement_not_found_fails() {
    let (_env, client, _admin) = setup();
    let result = client.try_get_retirement(&999u32);
    assert_eq!(result, Err(Ok(Error::RetirementNotFound)));
}

// ── Retirement certificates ───────────────────────────────────────────────────

fn make_oracle(env: &Env, client: &CarbonCreditContractClient<'_>, admin: &Address) -> Address {
    let oracle = Address::generate(env);
    client.register_oracle(admin, &oracle);
    oracle
}

fn registry(env: &Env) -> String {
    String::from_str(env, "Verra")
}

fn project(env: &Env) -> String {
    String::from_str(env, "VCS-1234")
}

#[test]
fn test_retire_with_certificate_records_serial_range() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let cert_id = client.retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &300,
        &300,
        &String::from_str(&env, "QmCert"),
    );
    assert_eq!(cert_id, 1);

    let cert = client.get_certificate(&cert_id);
    assert_eq!(cert.cert_id, 1);
    assert_eq!(cert.registry, registry(&env));
    assert_eq!(cert.project_id, project(&env));
    assert_eq!(cert.vintage, 2024);
    assert_eq!(cert.serial_start, 1);
    assert_eq!(cert.serial_end, 300);
    assert_eq!(cert.amount, 300);
    assert_eq!(cert.retiree, holder);
    assert_eq!(cert.oracle, oracle);

    // Fungible balance burned and counters updated.
    assert_eq!(client.get_balance(&holder), 700);
    assert_eq!(client.total_supply(), 700);
    assert_eq!(client.total_retired(), 300);
    assert_eq!(client.retirement_count(), 1);
    assert_eq!(client.retired_serial_cursor(&registry(&env), &project(&env), &2024), 300);
}

#[test]
fn test_certificate_queryable_by_hash() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let cert_id = client.retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "QmCert"),
    );
    let cert = client.get_certificate(&cert_id);
    let by_hash = client.get_certificate_by_hash(&cert.cert_hash);
    assert_eq!(by_hash.cert_id, cert_id);
    assert_eq!(by_hash.cert_hash, cert.cert_hash);
}

#[test]
fn test_certificate_hashes_are_unique() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let id1 = client.retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    let id2 = client.retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &101,
        &250,
        &150,
        &String::from_str(&env, "Qm2"),
    );
    assert_ne!(id1, id2);
    let c1 = client.get_certificate(&id1);
    let c2 = client.get_certificate(&id2);
    assert_ne!(c1.cert_hash, c2.cert_hash);
    assert_eq!(client.retired_serial_cursor(&registry(&env), &project(&env), &2024), 250);
}

#[test]
fn test_overlapping_serial_range_rejected() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    client.retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    let result = client.try_retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &50,
        &149,
        &100,
        &String::from_str(&env, "Qm2"),
    );
    assert_eq!(result, Err(Ok(Error::SerialRangeAlreadyRetired)));
    // Nothing was burned by the rejected retirement.
    assert_eq!(client.get_balance(&holder), 900);
    assert_eq!(client.retirement_count(), 1);
}

#[test]
fn test_duplicate_serial_range_rejected() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    client.retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    let result = client.try_retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    assert_eq!(result, Err(Ok(Error::SerialRangeAlreadyRetired)));
}

#[test]
fn test_unregistered_oracle_rejected() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = Address::generate(&env);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let result = client.try_retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    assert_eq!(result, Err(Ok(Error::OracleNotFound)));
    assert_eq!(client.get_balance(&holder), 1000);
}

#[test]
fn test_revoked_oracle_rejected() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);
    client.revoke_oracle(&admin, &oracle);
    assert!(!client.is_oracle(&oracle));

    let result = client.try_retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    assert_eq!(result, Err(Ok(Error::OracleNotFound)));
}

#[test]
fn test_register_oracle_requires_admin() {
    let (env, client, _admin) = setup();
    let impostor = Address::generate(&env);
    let oracle = Address::generate(&env);
    let result = client.try_register_oracle(&impostor, &oracle);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_register_duplicate_oracle_fails() {
    let (env, client, admin) = setup();
    let oracle = make_oracle(&env, &client, &admin);
    let result = client.try_register_oracle(&admin, &oracle);
    assert_eq!(result, Err(Ok(Error::OracleAlreadyRegistered)));
}

#[test]
fn test_serial_range_must_match_amount() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let result = client.try_retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &99,
        &String::from_str(&env, "Qm1"),
    );
    assert_eq!(result, Err(Ok(Error::InvalidSerialRange)));
}

#[test]
fn test_inverted_serial_range_rejected() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let result = client.try_retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &100,
        &1,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    assert_eq!(result, Err(Ok(Error::InvalidSerialRange)));
}

#[test]
fn test_certificate_requires_balance() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &10);

    let result = client.try_retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_certificate_not_found() {
    let (_env, client, _admin) = setup();
    let result = client.try_get_certificate(&42u32);
    assert_eq!(result, Err(Ok(Error::CertificateNotFound)));
}

#[test]
fn test_certificate_is_non_transferable() {
    // The contract exposes no transfer entry point for certificates: the only
    // way to obtain one is to burn credits, and the retiree is fixed at mint.
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let oracle = make_oracle(&env, &client, &admin);
    let holder = Address::generate(&env);
    let other = Address::generate(&env);
    client.mint(&issuer, &holder, &1000);

    let cert_id = client.retire_with_certificate(
        &holder,
        &oracle,
        &registry(&env),
        &project(&env),
        &2024,
        &1,
        &100,
        &100,
        &String::from_str(&env, "Qm1"),
    );
    let cert = client.get_certificate(&cert_id);
    assert_eq!(cert.retiree, holder);
    assert_ne!(cert.retiree, other);
    // Certificates do not confer a spendable balance.
    assert_eq!(client.get_balance(&other), 0);
}

// ── Full lifecycle ────────────────────────────────────────────────────────────

#[test]
fn test_full_lifecycle() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Mint to Alice
    client.mint(&issuer, &alice, &500);
    assert_eq!(client.total_supply(), 500);

    // Alice transfers 200 to Bob
    client.transfer(&alice, &bob, &200);
    assert_eq!(client.get_balance(&alice), 300);
    assert_eq!(client.get_balance(&bob), 200);

    // Bob retires 150
    client.retire(&bob, &150, &String::from_str(&env, "QmProjectA"));
    assert_eq!(client.get_balance(&bob), 50);
    assert_eq!(client.total_supply(), 350);
    assert_eq!(client.total_retired(), 150);

    // Alice retires 100
    client.retire(&alice, &100, &String::from_str(&env, "QmProjectB"));
    assert_eq!(client.total_retired(), 250);
    assert_eq!(client.retirement_count(), 2);
}
