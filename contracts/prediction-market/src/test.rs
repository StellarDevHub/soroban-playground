// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{PredictionMarket, PredictionMarketClient};
use crate::types::{Error, MarketStatus, MarketType};

// ── Test helpers ───────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, PredictionMarketClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PredictionMarket);
    let client = PredictionMarketClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn setup_initialized() -> (Env, Address, PredictionMarketClient<'static>) {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    (env, admin, client)
}

fn create_market_helper(
    env: &Env,
    client: &PredictionMarketClient<'_>,
    market_type: u32,
) -> (Address, Address, u32) {
    let creator = Address::generate(env);
    let oracle = Address::generate(env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(env, "Test market question?");
    let id = client.create_market(&creator, &question, &market_type, &deadline, &oracle);
    (creator, oracle, id)
}

// ── Initialization tests ──────────────────────────────────────────────────────

#[test]
fn test_initialize_succeeds() {
    let (_, admin, client) = setup();
    client.initialize(&admin);
    assert!(client.is_initialized());
}

#[test]
fn test_double_initialize_fails() {
    let (_, admin, client) = setup();
    client.initialize(&admin);
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_not_initialized_returns_false() {
    let (_, _, client) = setup();
    assert!(!client.is_initialized());
}

#[test]
fn test_market_count_zero_before_any_market() {
    let (_, _, client) = setup_initialized();
    assert_eq!(client.market_count(), 0);
}

// ── Market creation tests ─────────────────────────────────────────────────────

#[test]
fn test_create_binary_market() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    assert_eq!(id, 1);

    let market = client.get_market(&id);
    assert_eq!(market.id, 1);
    assert_eq!(market.market_type, MarketType::Binary);
    assert_eq!(market.status, MarketStatus::Open);
    assert_eq!(market.total_yes_stake, 0);
    assert_eq!(market.total_no_stake, 0);
    assert!(market.winning_outcome.is_none());
}

#[test]
fn test_create_scalar_market() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 1);
    let market = client.get_market(&id);
    assert_eq!(market.market_type, MarketType::Scalar);
}

#[test]
fn test_create_market_invalid_type_fails() {
    let (env, _, client) = setup_initialized();
    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");
    let result = client.try_create_market(&creator, &question, &99u32, &deadline, &oracle);
    assert_eq!(result, Err(Ok(Error::InvalidMarketType)));
}

#[test]
fn test_create_market_expired_deadline_fails() {
    let (env, _, client) = setup_initialized();
    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    // deadline in the past
    let deadline = env.ledger().timestamp();
    let question = String::from_str(&env, "Test?");
    let result = client.try_create_market(&creator, &question, &0u32, &deadline, &oracle);
    assert_eq!(result, Err(Ok(Error::MarketExpired)));
}

#[test]
fn test_market_count_increments_correctly() {
    let (env, _, client) = setup_initialized();
    assert_eq!(client.market_count(), 0);
    create_market_helper(&env, &client, 0);
    assert_eq!(client.market_count(), 1);
    create_market_helper(&env, &client, 0);
    assert_eq!(client.market_count(), 2);
    create_market_helper(&env, &client, 1);
    assert_eq!(client.market_count(), 3);
}

#[test]
fn test_create_market_not_initialized_fails() {
    let (env, _, client) = setup();
    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");
    let result = client.try_create_market(&creator, &question, &0u32, &deadline, &oracle);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

// ── Bet placement tests ───────────────────────────────────────────────────────

#[test]
fn test_place_bet_yes() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.place_bet(&trader, &id, &1u32, &500i128);

    let market = client.get_market(&id);
    assert_eq!(market.total_yes_stake, 500);
    assert_eq!(market.total_no_stake, 0);

    let pos = client.get_position(&id, &trader);
    assert_eq!(pos.stake, 500);
    assert_eq!(pos.outcome, 1);
}

#[test]
fn test_place_bet_no() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.place_bet(&trader, &id, &0u32, &300i128);

    let market = client.get_market(&id);
    assert_eq!(market.total_no_stake, 300);
    assert_eq!(market.total_yes_stake, 0);

    let pos = client.get_position(&id, &trader);
    assert_eq!(pos.stake, 300);
    assert_eq!(pos.outcome, 0);
}

#[test]
fn test_place_bet_accumulates_same_outcome() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.place_bet(&trader, &id, &1u32, &200i128);
    client.place_bet(&trader, &id, &1u32, &300i128);

    let pos = client.get_position(&id, &trader);
    assert_eq!(pos.stake, 500);

    let market = client.get_market(&id);
    assert_eq!(market.total_yes_stake, 500);
}

#[test]
fn test_place_bet_switch_outcome_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.place_bet(&trader, &id, &1u32, &200i128);
    // Switching from YES to NO should fail
    let result = client.try_place_bet(&trader, &id, &0u32, &100i128);
    assert_eq!(result, Err(Ok(Error::InvalidOutcome)));
}

#[test]
fn test_place_bet_zero_stake_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    let result = client.try_place_bet(&trader, &id, &1u32, &0i128);
    assert_eq!(result, Err(Ok(Error::ZeroStake)));
}

#[test]
fn test_place_bet_negative_stake_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    let result = client.try_place_bet(&trader, &id, &1u32, &(-100i128));
    assert_eq!(result, Err(Ok(Error::ZeroStake)));
}

#[test]
fn test_place_bet_invalid_outcome_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    let result = client.try_place_bet(&trader, &id, &2u32, &100i128);
    assert_eq!(result, Err(Ok(Error::InvalidOutcome)));
}

#[test]
fn test_place_bet_on_nonexistent_market_fails() {
    let (env, _, client) = setup_initialized();
    let trader = Address::generate(&env);

    let result = client.try_place_bet(&trader, &999u32, &1u32, &100i128);
    assert_eq!(result, Err(Ok(Error::MarketNotFound)));
}

#[test]
fn test_multiple_traders_can_bet_same_market() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader_a = Address::generate(&env);
    let trader_b = Address::generate(&env);
    let trader_c = Address::generate(&env);

    client.place_bet(&trader_a, &id, &1u32, &300i128);
    client.place_bet(&trader_b, &id, &0u32, &200i128);
    client.place_bet(&trader_c, &id, &1u32, &500i128);

    let market = client.get_market(&id);
    assert_eq!(market.total_yes_stake, 800);
    assert_eq!(market.total_no_stake, 200);
}

// ── Resolution tests ──────────────────────────────────────────────────────────

#[test]
fn test_resolve_market_yes_wins() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    client.resolve_market(&id, &1u32);

    let market = client.get_market(&id);
    assert_eq!(market.status, MarketStatus::Resolved);
    assert_eq!(market.winning_outcome, Some(1));
}

#[test]
fn test_resolve_market_no_wins() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    client.resolve_market(&id, &0u32);

    let market = client.get_market(&id);
    assert_eq!(market.status, MarketStatus::Resolved);
    assert_eq!(market.winning_outcome, Some(0));
}

#[test]
fn test_resolve_already_resolved_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    client.resolve_market(&id, &1u32);
    let result = client.try_resolve_market(&id, &0u32);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

#[test]
fn test_resolve_cancelled_market_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    client.cancel_market(&id);
    let result = client.try_resolve_market(&id, &1u32);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

#[test]
fn test_resolve_invalid_outcome_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    let result = client.try_resolve_market(&id, &2u32);
    assert_eq!(result, Err(Ok(Error::InvalidOutcome)));
}

#[test]
fn test_bet_after_resolve_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.resolve_market(&id, &1u32);
    let result = client.try_place_bet(&trader, &id, &1u32, &100i128);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

// ── Cancellation tests ────────────────────────────────────────────────────────

#[test]
fn test_cancel_open_market() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    client.cancel_market(&id);

    let market = client.get_market(&id);
    assert_eq!(market.status, MarketStatus::Cancelled);
}

#[test]
fn test_cancel_already_resolved_market_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    client.resolve_market(&id, &1u32);
    let result = client.try_cancel_market(&id);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

#[test]
fn test_cancel_already_cancelled_market_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);

    client.cancel_market(&id);
    let result = client.try_cancel_market(&id);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

#[test]
fn test_bet_after_cancel_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.cancel_market(&id);
    let result = client.try_place_bet(&trader, &id, &1u32, &100i128);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

// ── Payout calculation tests ──────────────────────────────────────────────────

#[test]
fn test_payout_winner_takes_all_pool() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let yes_trader = Address::generate(&env);
    let no_trader = Address::generate(&env);

    client.place_bet(&yes_trader, &id, &1u32, &500i128);
    client.place_bet(&no_trader, &id, &0u32, &500i128);
    client.resolve_market(&id, &1u32); // YES wins

    // YES trader: 500 YES stake, 1000 total pool → payout = 500 * 1000 / 500 = 1000
    let payout = client.calculate_payout(&id, &yes_trader);
    assert_eq!(payout, 1000);

    // NO trader: lost
    let loser_payout = client.calculate_payout(&id, &no_trader);
    assert_eq!(loser_payout, 0);
}

#[test]
fn test_payout_proportional_among_winners() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader_a = Address::generate(&env);
    let trader_b = Address::generate(&env);
    let no_trader = Address::generate(&env);

    // 300 YES + 700 YES + 500 NO = 1500 total; YES wins
    client.place_bet(&trader_a, &id, &1u32, &300i128);
    client.place_bet(&trader_b, &id, &1u32, &700i128);
    client.place_bet(&no_trader, &id, &0u32, &500i128);
    client.resolve_market(&id, &1u32);

    // trader_a: 300 * 1500 / 1000 = 450
    // trader_b: 700 * 1500 / 1000 = 1050
    let payout_a = client.calculate_payout(&id, &trader_a);
    let payout_b = client.calculate_payout(&id, &trader_b);
    assert_eq!(payout_a, 450);
    assert_eq!(payout_b, 1050);
    // total paid out = 1500 (all funds returned to winners)
    assert_eq!(payout_a + payout_b, 1500);
}

#[test]
fn test_payout_no_wins() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let yes_trader = Address::generate(&env);
    let no_trader = Address::generate(&env);

    client.place_bet(&yes_trader, &id, &1u32, &400i128);
    client.place_bet(&no_trader, &id, &0u32, &600i128);
    client.resolve_market(&id, &0u32); // NO wins

    let payout = client.calculate_payout(&id, &no_trader);
    assert_eq!(payout, 1000);

    let loser = client.calculate_payout(&id, &yes_trader);
    assert_eq!(loser, 0);
}

#[test]
fn test_payout_cancelled_market_refunds_stake() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.place_bet(&trader, &id, &1u32, &400i128);
    client.cancel_market(&id);

    let payout = client.calculate_payout(&id, &trader);
    assert_eq!(payout, 400); // full refund
}

#[test]
fn test_payout_on_unresolved_market_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.place_bet(&trader, &id, &1u32, &100i128);
    let result = client.try_calculate_payout(&id, &trader);
    assert_eq!(result, Err(Ok(Error::MarketNotResolved)));
}

#[test]
fn test_payout_no_position_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);
    let stranger = Address::generate(&env);

    client.place_bet(&trader, &id, &1u32, &100i128);
    client.resolve_market(&id, &1u32);

    // stranger never placed a bet
    let result = client.try_calculate_payout(&id, &stranger);
    assert_eq!(result, Err(Ok(Error::PositionNotFound)));
}

// ── Edge case / stress tests ──────────────────────────────────────────────────

#[test]
fn test_multiple_markets_independent() {
    let (env, _, client) = setup_initialized();
    let (_, _, id1) = create_market_helper(&env, &client, 0);
    let (_, _, id2) = create_market_helper(&env, &client, 1);

    let trader = Address::generate(&env);
    client.place_bet(&trader, &id1, &1u32, &100i128);
    client.place_bet(&trader, &id2, &0u32, &200i128);

    let m1 = client.get_market(&id1);
    let m2 = client.get_market(&id2);
    assert_eq!(m1.total_yes_stake, 100);
    assert_eq!(m1.total_no_stake, 0);
    assert_eq!(m2.total_no_stake, 200);
    assert_eq!(m2.total_yes_stake, 0);
}

#[test]
fn test_get_nonexistent_market_fails() {
    let (_, _, client) = setup_initialized();
    let result = client.try_get_market(&999u32);
    assert_eq!(result, Err(Ok(Error::MarketNotFound)));
}

#[test]
fn test_get_nonexistent_position_fails() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let stranger = Address::generate(&env);

    let result = client.try_get_position(&id, &stranger);
    assert_eq!(result, Err(Ok(Error::PositionNotFound)));
}

#[test]
fn test_only_one_side_bets_winner_gets_only_their_stake_back() {
    // Edge case: all bets on YES, NO wins → YES traders all get 0
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);

    client.place_bet(&trader, &id, &1u32, &1000i128);
    client.resolve_market(&id, &0u32); // NO wins, but no one bet NO

    // Winner pool (NO) = 0 → payout = 0
    let payout = client.calculate_payout(&id, &trader);
    assert_eq!(payout, 0);
}

#[test]
fn test_scalar_market_full_flow() {
    let (env, _, client) = setup_initialized();
    let (_, _, id) = create_market_helper(&env, &client, 1); // Scalar
    let trader_a = Address::generate(&env);
    let trader_b = Address::generate(&env);

    client.place_bet(&trader_a, &id, &1u32, &500i128);
    client.place_bet(&trader_b, &id, &0u32, &300i128);
    client.resolve_market(&id, &1u32);

    let payout_a = client.calculate_payout(&id, &trader_a);
    // 500 * 800 / 500 = 800
    assert_eq!(payout_a, 800);

    let payout_b = client.calculate_payout(&id, &trader_b);
    assert_eq!(payout_b, 0); // lost
}
