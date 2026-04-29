// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{ReitContract, ReitContractClient};
use crate::types::Error;

fn setup() -> (Env, Address, ReitContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, ReitContract);
    let client = ReitContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn add_prop(env: &Env, client: &ReitContractClient, admin: &Address) -> u32 {
    client
        .add_property(admin, &String::from_str(env, "Tower A"), &1000u64, &1_000_000i128)
        .unwrap()
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_init_ok() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, ReitContract);
    let client = ReitContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    assert_eq!(client.initialize(&admin), Ok(()));
}

#[test]
fn test_init_twice_fails() {
    let (_, admin, client) = setup();
    assert_eq!(client.initialize(&admin), Err(Ok(Error::AlreadyInitialized)));
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (_, admin, client) = setup();
    assert!(!client.is_paused());
    client.pause(&admin).unwrap();
    assert!(client.is_paused());
    client.unpause(&admin).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_mint() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    client.pause(&admin).unwrap();
    let investor = Address::generate(&env);
    assert_eq!(
        client.mint_shares(&investor, &pid, &10u64),
        Err(Ok(Error::ContractPaused))
    );
}

// ── Property ──────────────────────────────────────────────────────────────────

#[test]
fn test_add_property_ok() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    assert_eq!(pid, 1);
    let p = client.get_property(&pid).unwrap();
    assert_eq!(p.total_shares, 1000);
    assert!(p.is_active);
}

#[test]
fn test_add_property_empty_name() {
    let (env, admin, client) = setup();
    assert_eq!(
        client.add_property(&admin, &String::from_str(&env, ""), &100u64, &1000i128),
        Err(Ok(Error::EmptyName))
    );
}

#[test]
fn test_deactivate_property() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    client.deactivate_property(&admin, &pid).unwrap();
    let investor = Address::generate(&env);
    assert_eq!(
        client.mint_shares(&investor, &pid, &10u64),
        Err(Ok(Error::PropertyInactive))
    );
}

// ── Mint / Burn ───────────────────────────────────────────────────────────────

#[test]
fn test_mint_shares_ok() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let investor = Address::generate(&env);
    let cost = client.mint_shares(&investor, &pid, &100u64).unwrap();
    assert_eq!(cost, 100 * 1_000_000);
    let h = client.get_holding(&investor, &pid).unwrap();
    assert_eq!(h.shares, 100);
}

#[test]
fn test_mint_exceeds_supply() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let investor = Address::generate(&env);
    assert_eq!(
        client.mint_shares(&investor, &pid, &1001u64),
        Err(Ok(Error::ExceedsTotalSupply))
    );
}

#[test]
fn test_burn_shares_ok() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let investor = Address::generate(&env);
    client.mint_shares(&investor, &pid, &100u64).unwrap();
    client.burn_shares(&investor, &pid, &50u64).unwrap();
    let h = client.get_holding(&investor, &pid).unwrap();
    assert_eq!(h.shares, 50);
}

#[test]
fn test_burn_excess_fails() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let investor = Address::generate(&env);
    client.mint_shares(&investor, &pid, &10u64).unwrap();
    assert_eq!(
        client.burn_shares(&investor, &pid, &20u64),
        Err(Ok(Error::InsufficientShares))
    );
}

// ── Transfer ──────────────────────────────────────────────────────────────────

#[test]
fn test_transfer_shares_ok() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.mint_shares(&a, &pid, &100u64).unwrap();
    client.transfer_shares(&a, &b, &pid, &40u64).unwrap();
    assert_eq!(client.get_holding(&a, &pid).unwrap().shares, 60);
    assert_eq!(client.get_holding(&b, &pid).unwrap().shares, 40);
}

#[test]
fn test_transfer_self_fails() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let a = Address::generate(&env);
    client.mint_shares(&a, &pid, &100u64).unwrap();
    assert_eq!(
        client.transfer_shares(&a, &a, &pid, &10u64),
        Err(Ok(Error::InvalidRecipient))
    );
}

// ── Dividends ─────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_and_claim_dividends() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let investor = Address::generate(&env);
    client.mint_shares(&investor, &pid, &500u64).unwrap(); // 50% of 1000
    client.deposit_dividends(&admin, &pid, &1_000_000i128).unwrap();
    let pending = client.pending_dividends(&investor, &pid).unwrap();
    assert_eq!(pending, 500_000); // 50% of 1_000_000
    let claimed = client.claim_dividends(&investor, &pid).unwrap();
    assert_eq!(claimed, 500_000);
    // Nothing left to claim
    assert_eq!(
        client.claim_dividends(&investor, &pid),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn test_dividends_pro_rata_two_investors() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.mint_shares(&a, &pid, &300u64).unwrap();
    client.mint_shares(&b, &pid, &700u64).unwrap();
    client.deposit_dividends(&admin, &pid, &1_000_000i128).unwrap();
    assert_eq!(client.pending_dividends(&a, &pid).unwrap(), 300_000);
    assert_eq!(client.pending_dividends(&b, &pid).unwrap(), 700_000);
}

#[test]
fn test_new_investor_no_retroactive_dividends() {
    let (env, admin, client) = setup();
    let pid = add_prop(&env, &client, &admin);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    client.mint_shares(&a, &pid, &500u64).unwrap();
    client.deposit_dividends(&admin, &pid, &1_000_000i128).unwrap();
    // b mints AFTER dividend deposit
    client.mint_shares(&b, &pid, &500u64).unwrap();
    // b should have 0 pending (joined after deposit)
    assert_eq!(client.pending_dividends(&b, &pid).unwrap(), 0);
    // a still has full 1_000_000 (was sole holder at deposit time)
    assert_eq!(client.pending_dividends(&a, &pid).unwrap(), 1_000_000);
}

#[test]
fn test_property_count() {
    let (env, admin, client) = setup();
    add_prop(&env, &client, &admin);
    add_prop(&env, &client, &admin);
    assert_eq!(client.property_count(), 2);
}
