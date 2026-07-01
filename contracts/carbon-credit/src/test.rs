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
    client.initialize(&admin).unwrap();
    (env, client, admin)
}

fn make_issuer(env: &Env, client: &CarbonCreditContractClient<'_>, admin: &Address) -> Address {
    let issuer = Address::generate(env);
    client
        .register_issuer(&issuer, &String::from_str(env, "EcoCorp"))
        .unwrap();
    client.verify_issuer(admin, &issuer).unwrap();
    issuer
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin().unwrap(), admin);
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
    client
        .register_issuer(&issuer, &String::from_str(&env, "GreenCo"))
        .unwrap();
    let info = client.get_issuer_info(&issuer).unwrap();
    assert_eq!(info.verified, false);
    assert_eq!(info.total_minted, 0);
}

#[test]
fn test_register_duplicate_issuer_fails() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    client
        .register_issuer(&issuer, &String::from_str(&env, "GreenCo"))
        .unwrap();
    let result =
        client.try_register_issuer(&issuer, &String::from_str(&env, "GreenCo2"));
    assert_eq!(result, Err(Ok(Error::IssuerAlreadyRegistered)));
}

#[test]
fn test_verify_issuer() {
    let (env, client, admin) = setup();
    let issuer = Address::generate(&env);
    client
        .register_issuer(&issuer, &String::from_str(&env, "EcoCorp"))
        .unwrap();
    client.verify_issuer(&admin, &issuer).unwrap();
    let info = client.get_issuer_info(&issuer).unwrap();
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
    client
        .register_issuer(&issuer, &String::from_str(&env, "EcoCorp"))
        .unwrap();
    let result = client.try_verify_issuer(&impostor, &issuer);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Minting ───────────────────────────────────────────────────────────────────

#[test]
fn test_mint_increases_balance_and_supply() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);

    client.mint(&issuer, &holder, &1000).unwrap();
    assert_eq!(client.get_balance(&holder), 1000);
    assert_eq!(client.total_supply(), 1000);

    let info = client.get_issuer_info(&issuer).unwrap();
    assert_eq!(info.total_minted, 1000);
}

#[test]
fn test_mint_unverified_issuer_fails() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    client
        .register_issuer(&issuer, &String::from_str(&env, "DirtyCorp"))
        .unwrap();
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

    client.mint(&issuer, &alice, &1000).unwrap();
    client.transfer(&alice, &bob, &400).unwrap();

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

    client.mint(&issuer, &alice, &100).unwrap();
    let result = client.try_transfer(&alice, &bob, &200);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_transfer_zero_amount_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.mint(&issuer, &alice, &100).unwrap();
    let result = client.try_transfer(&alice, &bob, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

// ── Retirement ledger ─────────────────────────────────────────────────────────

#[test]
fn test_retire_creates_immutable_record() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &1000).unwrap();

    let id = client
        .retire(
            &holder,
            &300,
            &String::from_str(&env, "QmProjectHash123"),
        )
        .unwrap();
    assert_eq!(id, 1);

    let record = client.get_retirement(&1).unwrap();
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
    client.mint(&issuer, &holder, &1000).unwrap();

    let id1 = client
        .retire(&holder, &100, &String::from_str(&env, "Qm1"))
        .unwrap();
    let id2 = client
        .retire(&holder, &200, &String::from_str(&env, "Qm2"))
        .unwrap();

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_retirement(&1).unwrap().amount, 100);
    assert_eq!(client.get_retirement(&2).unwrap().amount, 200);
    assert_eq!(client.total_retired(), 300);
    assert_eq!(client.retirement_count(), 2);
}

#[test]
fn test_retire_insufficient_balance_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &100).unwrap();
    let result =
        client.try_retire(&holder, &500, &String::from_str(&env, "Qm"));
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_retire_zero_amount_fails() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let holder = Address::generate(&env);
    client.mint(&issuer, &holder, &100).unwrap();
    let result =
        client.try_retire(&holder, &0, &String::from_str(&env, "Qm"));
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_retirement_not_found_fails() {
    let (_env, client, _admin) = setup();
    let result = client.try_get_retirement(&999u32);
    assert_eq!(result, Err(Ok(Error::RetirementNotFound)));
}

// ── Full lifecycle ────────────────────────────────────────────────────────────

#[test]
fn test_full_lifecycle() {
    let (env, client, admin) = setup();
    let issuer = make_issuer(&env, &client, &admin);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Mint to Alice
    client.mint(&issuer, &alice, &500).unwrap();
    assert_eq!(client.total_supply(), 500);

    // Alice transfers 200 to Bob
    client.transfer(&alice, &bob, &200).unwrap();
    assert_eq!(client.get_balance(&alice), 300);
    assert_eq!(client.get_balance(&bob), 200);

    // Bob retires 150
    client
        .retire(&bob, &150, &String::from_str(&env, "QmProjectA"))
        .unwrap();
    assert_eq!(client.get_balance(&bob), 50);
    assert_eq!(client.total_supply(), 350);
    assert_eq!(client.total_retired(), 150);

    // Alice retires 100
    client
        .retire(&alice, &100, &String::from_str(&env, "QmProjectB"))
        .unwrap();
    assert_eq!(client.total_retired(), 250);
    assert_eq!(client.retirement_count(), 2);
}
