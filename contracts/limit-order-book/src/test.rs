// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::types::{Error, OrderStatus, Side};
use crate::{LimitOrderBookContract, LimitOrderBookContractClient};

fn setup() -> (Env, LimitOrderBookContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LimitOrderBookContract);
    let client = LimitOrderBookContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (_, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
    assert_eq!(client.order_count(), 0);
}

#[test]
fn test_double_initialize_fails() {
    let (_, client, admin) = setup();
    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ── Place order ───────────────────────────────────────────────────────────────

#[test]
fn test_place_buy_order() {
    let (env, client, _) = setup();
    let buyer = Address::generate(&env);
    let id = client.place_order(&buyer, &Side::Buy, &1_000_000, &5_000_000);
    assert_eq!(id, 1);
    let order = client.get_order(&id);
    assert_eq!(order.owner, buyer);
    assert_eq!(order.remaining, 5_000_000);
    assert_eq!(order.status, OrderStatus::Open);
}

#[test]
fn test_place_order_zero_price_fails() {
    let (env, client, _) = setup();
    let buyer = Address::generate(&env);
    assert_eq!(
        client.try_place_order(&buyer, &Side::Buy, &0, &1_000_000),
        Err(Ok(Error::ZeroPrice))
    );
}

#[test]
fn test_place_order_zero_quantity_fails() {
    let (env, client, _) = setup();
    let buyer = Address::generate(&env);
    assert_eq!(
        client.try_place_order(&buyer, &Side::Buy, &1_000_000, &0),
        Err(Ok(Error::ZeroAmount))
    );
}

// ── Cancel order ──────────────────────────────────────────────────────────────

#[test]
fn test_cancel_order() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let id = client.place_order(&seller, &Side::Sell, &1_000_000, &3_000_000);
    client.cancel_order(&seller, &id);
    let order = client.get_order(&id);
    assert_eq!(order.status, OrderStatus::Cancelled);
}

#[test]
fn test_cancel_wrong_owner_fails() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let other = Address::generate(&env);
    let id = client.place_order(&seller, &Side::Sell, &1_000_000, &3_000_000);
    assert_eq!(
        client.try_cancel_order(&other, &id),
        Err(Ok(Error::NotOrderOwner))
    );
}

#[test]
fn test_cancel_already_cancelled_fails() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let id = client.place_order(&seller, &Side::Sell, &1_000_000, &3_000_000);
    client.cancel_order(&seller, &id);
    assert_eq!(
        client.try_cancel_order(&seller, &id),
        Err(Ok(Error::OrderInactive))
    );
}

// ── Matching ──────────────────────────────────────────────────────────────────

#[test]
fn test_full_match() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Sell 5 @ 1_000_000
    let sell_id = client.place_order(&seller, &Side::Sell, &1_000_000, &5_000_000);
    // Buy 5 @ 1_000_000 — should fully match
    let buy_id = client.place_order(&buyer, &Side::Buy, &1_000_000, &5_000_000);

    let sell_order = client.get_order(&sell_id);
    let buy_order = client.get_order(&buy_id);
    assert_eq!(sell_order.status, OrderStatus::Filled);
    assert_eq!(buy_order.status, OrderStatus::Filled);
    assert_eq!(client.total_volume(), 5_000_000);
}

#[test]
fn test_partial_match() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Sell 10 @ 1_000_000
    let sell_id = client.place_order(&seller, &Side::Sell, &1_000_000, &10_000_000);
    // Buy 4 @ 1_000_000 — partial fill of sell order
    let buy_id = client.place_order(&buyer, &Side::Buy, &1_000_000, &4_000_000);

    let sell_order = client.get_order(&sell_id);
    let buy_order = client.get_order(&buy_id);
    assert_eq!(sell_order.status, OrderStatus::PartiallyFilled);
    assert_eq!(sell_order.remaining, 6_000_000);
    assert_eq!(buy_order.status, OrderStatus::Filled);
}

#[test]
fn test_no_match_price_mismatch() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Sell @ 2_000_000, buy @ 1_000_000 — no match
    let sell_id = client.place_order(&seller, &Side::Sell, &2_000_000, &5_000_000);
    let buy_id = client.place_order(&buyer, &Side::Buy, &1_000_000, &5_000_000);

    assert_eq!(client.get_order(&sell_id).status, OrderStatus::Open);
    assert_eq!(client.get_order(&buy_id).status, OrderStatus::Open);
    assert_eq!(client.total_volume(), 0);
}

// ── Pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_orders() {
    let (env, client, admin) = setup();
    client.pause(&admin);
    assert!(client.is_paused());
    let buyer = Address::generate(&env);
    assert_eq!(
        client.try_place_order(&buyer, &Side::Buy, &1_000_000, &1_000_000),
        Err(Ok(Error::ContractPaused))
    );
}

#[test]
fn test_unpause_resumes_orders() {
    let (env, client, admin) = setup();
    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());
    let buyer = Address::generate(&env);
    let id = client.place_order(&buyer, &Side::Buy, &1_000_000, &1_000_000);
    assert_eq!(id, 1);
}

#[test]
fn test_non_admin_cannot_pause() {
    let (env, client, _) = setup();
    let rando = Address::generate(&env);
    assert_eq!(client.try_pause(&rando), Err(Ok(Error::Unauthorized)));
}

// ── Admin transfer ────────────────────────────────────────────────────────────

#[test]
fn test_set_admin() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);
    client.set_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

// ── Views ─────────────────────────────────────────────────────────────────────

#[test]
fn test_order_not_found() {
    let (_, client, _) = setup();
    assert_eq!(client.try_get_order(&999), Err(Ok(Error::OrderNotFound)));
}

#[test]
fn test_order_count_increments() {
    let (env, client, _) = setup();
    let user = Address::generate(&env);
    client.place_order(&user, &Side::Buy, &1_000_000, &1_000_000);
    client.place_order(&user, &Side::Sell, &2_000_000, &1_000_000);
    assert_eq!(client.order_count(), 2);
}
