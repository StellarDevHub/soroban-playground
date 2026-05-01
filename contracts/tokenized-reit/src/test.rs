// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{TokenizedReitContract, TokenizedReitContractClient};

fn setup() -> (Env, Address, TokenizedReitContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenizedReitContract);
    let client = TokenizedReitContractClient::new(&env, &contract_id);
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
fn test_double_initialize_fails() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
fn test_create_trust() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let id = client.create_trust(
        &admin,
        &String::from_str(&env, "Downtown Office REIT"),
        &1000,
        &1_000_000,
        &500,
    );
    assert_eq!(id, 1);
    assert_eq!(client.trust_count(), 1);
    let trust = client.get_trust(&1);
    assert_eq!(trust.total_shares, 1000);
    assert!(trust.is_active);
}

#[test]
fn test_buy_shares_and_claim_dividends() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let trust_id = client.create_trust(
        &admin,
        &String::from_str(&env, "Retail REIT"),
        &1000,
        &500_000,
        &400,
    );

    let investor = Address::generate(&env);
    let cost = client.buy_shares(&investor, &trust_id, &100);
    assert_eq!(cost, 100 * 500_000);

    // Deposit dividends
    client.deposit_dividends(&admin, &trust_id, &10_000_000);

    // Investor holds 100/1000 = 10% → claimable = 1_000_000
    let claimable = client.claimable_dividends(&investor, &trust_id);
    assert_eq!(claimable, 1_000_000);

    let claimed = client.claim_dividends(&investor, &trust_id);
    assert_eq!(claimed, 1_000_000);

    // Nothing left to claim
    let claimable_after = client.claimable_dividends(&investor, &trust_id);
    assert_eq!(claimable_after, 0);
}

#[test]
fn test_transfer_shares() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let trust_id = client.create_trust(
        &admin,
        &String::from_str(&env, "Industrial REIT"),
        &1000,
        &200_000,
        &300,
    );

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.buy_shares(&alice, &trust_id, &200);
    client.transfer_shares(&alice, &bob, &trust_id, &100);

    let alice_holding = client.get_holding(&alice, &trust_id);
    let bob_holding = client.get_holding(&bob, &trust_id);
    assert_eq!(alice_holding.shares, 100);
    assert_eq!(bob_holding.shares, 100);
}

#[test]
fn test_pause_blocks_investor_ops() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let trust_id = client.create_trust(
        &admin,
        &String::from_str(&env, "Residential REIT"),
        &500,
        &100_000,
        &600,
    );

    client.pause(&admin);
    assert!(client.is_paused());

    let investor = Address::generate(&env);
    let result = client.try_buy_shares(&investor, &trust_id, &10);
    assert!(result.is_err());

    client.unpause(&admin);
    assert!(!client.is_paused());
    let cost = client.buy_shares(&investor, &trust_id, &10);
    assert!(cost > 0);
}

#[test]
fn test_deactivate_trust_blocks_buys() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let trust_id = client.create_trust(
        &admin,
        &String::from_str(&env, "Mixed-Use REIT"),
        &500,
        &100_000,
        &450,
    );
    client.deactivate_trust(&admin, &trust_id);
    let investor = Address::generate(&env);
    let result = client.try_buy_shares(&investor, &trust_id, &10);
    assert!(result.is_err());
}

#[test]
fn test_new_investor_does_not_claim_old_dividends() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let trust_id = client.create_trust(
        &admin,
        &String::from_str(&env, "Hotel REIT"),
        &1000,
        &100_000,
        &500,
    );

    let early = Address::generate(&env);
    client.buy_shares(&early, &trust_id, &500);
    client.deposit_dividends(&admin, &trust_id, &10_000_000);

    // Late investor buys after dividend deposit
    let late = Address::generate(&env);
    client.buy_shares(&late, &trust_id, &500);

    // Late investor should have 0 claimable (snapshot taken at buy time)
    let late_claimable = client.claimable_dividends(&late, &trust_id);
    assert_eq!(late_claimable, 0);

    // Early investor should claim their full share
    let early_claimable = client.claimable_dividends(&early, &trust_id);
    assert_eq!(early_claimable, 5_000_000); // 500/1000 * 10_000_000
}
