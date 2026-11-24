// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::types::{Error, OrderStatus, Side, MAX_MATCHED_FILLS};
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
    assert_eq!(client.best_bid(), 1_000_000);
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
    assert_eq!(client.best_ask(), 1_000_000);
    client.cancel_order(&seller, &id);
    let order = client.get_order(&id);
    assert_eq!(order.status, OrderStatus::Cancelled);
    assert_eq!(client.best_ask(), 0);
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
    assert_eq!(client.best_ask(), 0);
    assert_eq!(client.best_bid(), 0);
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
fn test_best_price_priority() {
    let (env, client, _) = setup();
    let seller_high = Address::generate(&env);
    let seller_low = Address::generate(&env);
    let buyer = Address::generate(&env);

    let high_sell = client.place_order(&seller_high, &Side::Sell, &1_000_000, &5_000_000);
    let low_sell = client.place_order(&seller_low, &Side::Sell, &900_000, &5_000_000);
    client.place_order(&buyer, &Side::Buy, &1_000_000, &5_000_000);

    assert_eq!(client.get_order(&low_sell).status, OrderStatus::Filled);
    assert_eq!(client.get_order(&high_sell).status, OrderStatus::Open);
}

#[test]
fn test_time_priority_when_prices_equal() {
    let (env, client, _) = setup();
    let seller_first = Address::generate(&env);
    let seller_second = Address::generate(&env);
    let buyer = Address::generate(&env);

    let first_sell = client.place_order(&seller_first, &Side::Sell, &1_000_000, &3_000_000);
    let second_sell = client.place_order(&seller_second, &Side::Sell, &1_000_000, &3_000_000);
    client.place_order(&buyer, &Side::Buy, &1_000_000, &4_000_000);

    assert_eq!(client.get_order(&first_sell).status, OrderStatus::Filled);
    assert_eq!(
        client.get_order(&second_sell).status,
        OrderStatus::PartiallyFilled
    );
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

// ── Bucketed Price-Level & Linked-List Priority Guarantees ────────────────────

#[test]
fn test_large_book_matches_beyond_200_orders_strict_price_time() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Populate > 220 worse-priced sell orders first so linear scan would have missed later orders
    for i in 0..220u64 {
        env.budget().reset_unlimited();
        let price = 2_000_000 + (i as i128 % 10) * 10_000;
        client.place_order(&seller, &Side::Sell, &price, &1_000_000);
    }
    env.budget().reset_default();

    // Now place three orders at better price 950_000 in strict sequence
    let best_first = client.place_order(&seller, &Side::Sell, &950_000, &2_000_000);
    let best_middle = client.place_order(&seller, &Side::Sell, &950_000, &2_000_000);
    let best_third = client.place_order(&seller, &Side::Sell, &950_000, &2_000_000);

    // Cancel the middle order to verify O(1) doubly-linked list unlinking mid-bucket
    client.cancel_order(&seller, &best_middle);

    // Buy 3_000_000 @ 1_000_000 -> must fill best_first completely and best_third partially
    let buy_id = client.place_order(&buyer, &Side::Buy, &1_000_000, &3_000_000);

    assert_eq!(client.get_order(&buy_id).status, OrderStatus::Filled);
    assert_eq!(client.get_order(&best_first).status, OrderStatus::Filled);
    assert_eq!(
        client.get_order(&best_middle).status,
        OrderStatus::Cancelled
    );
    let third = client.get_order(&best_third);
    assert_eq!(third.status, OrderStatus::PartiallyFilled);
    assert_eq!(third.remaining, 1_000_000);
}

#[test]
fn test_max_matched_fills_cap_per_transaction() {
    let (env, client, _) = setup();
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    let total_orders = MAX_MATCHED_FILLS + 5;
    for _ in 0..total_orders {
        client.place_order(&seller, &Side::Sell, &1_000_000, &1_000_000);
    }

    // Place a single large buy order that could cross all `total_orders`
    let large_qty = (total_orders as i128) * 1_000_000;
    let buy_id = client.place_order(&buyer, &Side::Buy, &1_000_000, &large_qty);

    // First transaction caps at MAX_MATCHED_FILLS fills
    let buy_order = client.get_order(&buy_id);
    assert_eq!(buy_order.status, OrderStatus::PartiallyFilled);
    assert_eq!(buy_order.remaining, 5 * 1_000_000);
    assert_eq!(
        client.total_volume(),
        (MAX_MATCHED_FILLS as i128) * 1_000_000
    );

    // Subsequent call to `match_orders` completes the remaining 5 fills
    let trades = client.match_orders(&buy_id);
    assert_eq!(trades.len(), 5);
    assert_eq!(client.get_order(&buy_id).status, OrderStatus::Filled);
    assert_eq!(client.total_volume(), large_qty);
}

#[test]
fn test_benchmark_sub_100k_instructions_per_matched_trade() {
    let (env, client, _) = setup();
    let contract_id = client.address.clone();
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    // Populate a deep order book with 250 resting orders across multiple price levels
    for i in 0..250u64 {
        env.budget().reset_unlimited();
        let price = 1_100_000 + (i as i128 % 25) * 10_000;
        client.place_order(&seller, &Side::Sell, &price, &1_000_000);
    }

    // Place 10 resting orders at the top-of-book (1_000_000)
    for _ in 0..10 {
        env.budget().reset_unlimited();
        client.place_order(&seller, &Side::Sell, &1_000_000, &1_000_000);
    }

    // Create the aggressor order in storage, then benchmark the pure matching engine
    // (`try_match`) across 10 matched trades against the 260-order book.
    let buy_id = env.as_contract(&contract_id, || {
        let id = crate::storage::get_order_count(&env) + 1;
        crate::storage::set_order_count(&env, id);
        let order = crate::types::Order {
            id,
            owner: buyer.clone(),
            side: Side::Buy,
            price: 1_000_000,
            quantity: 10_000_000,
            remaining: 10_000_000,
            status: OrderStatus::Open,
            created_at: env.ledger().sequence(),
        };
        crate::storage::set_order(&env, &order);
        id
    });

    let (trades_len, cpu_insns_total) = env.as_contract(&contract_id, || {
        env.budget().reset_default();
        let before = env.budget().cpu_instruction_cost();
        let trades = LimitOrderBookContract::try_match(&env, buy_id).unwrap();
        let after = env.budget().cpu_instruction_cost();
        (trades.len(), after.saturating_sub(before))
    });
    env.budget().reset_unlimited();

    assert_eq!(trades_len, 10);
    let cpu_insns_per_trade = cpu_insns_total / 10;

    assert_eq!(client.get_order(&buy_id).status, OrderStatus::Filled);
    assert!(
        cpu_insns_per_trade < 100_000,
        "Expected < 100,000 CPU instructions per matched trade, got {} (total: {})",
        cpu_insns_per_trade,
        cpu_insns_total
    );
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
