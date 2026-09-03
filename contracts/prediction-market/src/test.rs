// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String, Vec,
};

use crate::types::{Error, MarketStatus, MarketType};
use crate::{PredictionMarket, PredictionMarketClient};

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

struct ConditionalFixture {
    env: Env,
    client: PredictionMarketClient<'static>,
    creator: Address,
    oracle: Address,
    token_client: TokenClient<'static>,
    token_admin: StellarAssetClient<'static>,
    market_id: u32,
    deadline: u64,
}

fn setup_conditional(outcome_count: u32) -> ConditionalFixture {
    let (env, _, client) = setup_initialized();
    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let resolver = Address::generate(&env);
    let token_issuer = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_issuer);
    let token = token_contract.address();
    let token_client = TokenClient::new(&env, &token);
    let token_admin = StellarAssetClient::new(&env, &token);
    token_admin.mint(&creator, &10_000);
    let deadline = env.ledger().timestamp() + 1_000;
    let question = String::from_str(&env, "Which outcome wins?");
    let market_id = if outcome_count == 2 {
        client.create_binary_market(
            &creator, &question, &deadline, &oracle, &resolver, &token, &100, &1_000,
        )
    } else {
        let outcomes = Vec::from_array(
            &env,
            [
                String::from_str(&env, "red"),
                String::from_str(&env, "green"),
                String::from_str(&env, "blue"),
            ],
        );
        client.create_categorical_market(
            &creator, &question, &outcomes, &deadline, &oracle, &resolver, &token, &100, &1_000,
        )
    };
    ConditionalFixture {
        env,
        client,
        creator,
        oracle,
        token_client,
        token_admin,
        market_id,
        deadline,
    }
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

// -- Collateralized binary and categorical markets --------------------------

#[test]
fn test_create_categorical_market_mints_complete_sets_and_lp_shares() {
    let fixture = setup_conditional(3);
    let conditional = fixture.client.get_conditional_market(&fixture.market_id);

    assert_eq!(conditional.outcomes.len(), 3);
    assert_eq!(
        conditional.pool_balances,
        Vec::from_array(&fixture.env, [1_000, 1_000, 1_000])
    );
    assert_eq!(conditional.collateral_locked, 1_000);
    assert_eq!(conditional.minimum_dispute_bond, 10);
    assert_eq!(
        fixture
            .client
            .liquidity_balance(&fixture.market_id, &fixture.creator),
        1_000
    );
    assert_eq!(fixture.token_client.balance(&fixture.creator), 9_000);
}

#[test]
fn test_buy_shares_uses_fixed_product_quote_and_escrows_collateral() {
    let fixture = setup_conditional(2);
    let buyer = Address::generate(&fixture.env);
    fixture.token_admin.mint(&buyer, &500);

    let quote = fixture.client.quote_buy(&fixture.market_id, &1, &100);
    assert_eq!(quote, 190);
    let received = fixture
        .client
        .buy_shares(&buyer, &fixture.market_id, &1, &100, &190);

    assert_eq!(received, 190);
    assert_eq!(
        fixture
            .client
            .outcome_balance(&fixture.market_id, &buyer, &1),
        190
    );
    assert_eq!(fixture.token_client.balance(&buyer), 400);
    let conditional = fixture.client.get_conditional_market(&fixture.market_id);
    assert_eq!(
        conditional.pool_balances,
        Vec::from_array(&fixture.env, [1_100, 910])
    );
    assert_eq!(conditional.collateral_locked, 1_100);
    assert!(fixture.client.spot_price(&fixture.market_id, &1) > 5_000);
}

#[test]
fn test_buy_shares_slippage_guard_is_atomic() {
    let fixture = setup_conditional(2);
    let buyer = Address::generate(&fixture.env);
    fixture.token_admin.mint(&buyer, &500);

    assert_eq!(
        fixture
            .client
            .try_buy_shares(&buyer, &fixture.market_id, &1, &100, &191),
        Err(Ok(Error::SlippageExceeded))
    );
    assert_eq!(fixture.token_client.balance(&buyer), 500);
    assert_eq!(
        fixture
            .client
            .outcome_balance(&fixture.market_id, &buyer, &1),
        0
    );
}

#[test]
fn test_liquidity_can_be_removed_and_complete_set_redeemed() {
    let fixture = setup_conditional(3);
    let provider = Address::generate(&fixture.env);
    fixture.token_admin.mint(&provider, &500);

    let minted = fixture
        .client
        .add_liquidity(&provider, &fixture.market_id, &300, &300);
    assert_eq!(minted, 300);
    let basket = fixture
        .client
        .remove_liquidity(&provider, &fixture.market_id, &300);
    assert_eq!(basket, Vec::from_array(&fixture.env, [300, 300, 300]));

    fixture
        .client
        .redeem_complete_set(&provider, &fixture.market_id, &300);
    assert_eq!(fixture.token_client.balance(&provider), 500);
    assert_eq!(
        fixture
            .client
            .liquidity_balance(&fixture.market_id, &provider),
        0
    );
}

#[test]
fn test_undisputed_resolution_finalizes_after_window_and_redeems() {
    let fixture = setup_conditional(2);
    let buyer = Address::generate(&fixture.env);
    fixture.token_admin.mint(&buyer, &500);
    let shares = fixture
        .client
        .buy_shares(&buyer, &fixture.market_id, &1, &100, &1);

    fixture.env.ledger().set_timestamp(fixture.deadline);
    fixture.client.propose_resolution(&fixture.market_id, &1);
    assert_eq!(
        fixture.client.try_finalize_resolution(&fixture.market_id),
        Err(Ok(Error::DisputeWindowActive))
    );
    fixture.env.ledger().set_timestamp(fixture.deadline + 100);
    fixture.client.finalize_resolution(&fixture.market_id);
    assert_eq!(
        fixture.client.get_market(&fixture.market_id).status,
        MarketStatus::Resolved
    );

    fixture
        .client
        .redeem_winnings(&buyer, &fixture.market_id, &shares);
    assert_eq!(fixture.token_client.balance(&buyer), 500 - 100 + shares);
    assert_eq!(
        fixture
            .client
            .outcome_balance(&fixture.market_id, &buyer, &1),
        0
    );
}

#[test]
fn test_dispute_overturn_returns_bond_and_sets_final_outcome() {
    let fixture = setup_conditional(3);
    let challenger = Address::generate(&fixture.env);
    fixture.token_admin.mint(&challenger, &250);
    fixture.env.ledger().set_timestamp(fixture.deadline);
    fixture.client.propose_resolution(&fixture.market_id, &0);
    fixture
        .client
        .dispute_resolution(&challenger, &fixture.market_id, &200);
    assert_eq!(fixture.token_client.balance(&challenger), 50);

    fixture.client.resolve_dispute(&fixture.market_id, &2);
    assert_eq!(fixture.token_client.balance(&challenger), 250);
    let market = fixture.client.get_market(&fixture.market_id);
    assert_eq!(market.status, MarketStatus::Resolved);
    assert_eq!(market.winning_outcome, Some(2));
}

#[test]
fn test_upheld_dispute_bond_is_awarded_to_oracle() {
    let fixture = setup_conditional(2);
    let challenger = Address::generate(&fixture.env);
    fixture.token_admin.mint(&challenger, &100);
    fixture.env.ledger().set_timestamp(fixture.deadline);
    fixture.client.propose_resolution(&fixture.market_id, &1);
    fixture
        .client
        .dispute_resolution(&challenger, &fixture.market_id, &100);
    fixture.client.resolve_dispute(&fixture.market_id, &1);

    assert_eq!(fixture.token_client.balance(&challenger), 0);
    assert_eq!(fixture.token_client.balance(&fixture.oracle), 100);
}

#[test]
fn test_resolution_and_trading_deadlines_are_enforced() {
    let fixture = setup_conditional(2);
    assert_eq!(
        fixture
            .client
            .try_propose_resolution(&fixture.market_id, &1),
        Err(Ok(Error::ResolutionTooEarly))
    );
    fixture.env.ledger().set_timestamp(fixture.deadline);
    assert_eq!(
        fixture
            .client
            .try_buy_shares(&fixture.creator, &fixture.market_id, &1, &10, &1,),
        Err(Ok(Error::MarketExpired))
    );
    let challenger = Address::generate(&fixture.env);
    fixture.token_admin.mint(&challenger, &10);
    fixture.client.propose_resolution(&fixture.market_id, &1);
    assert_eq!(
        fixture
            .client
            .try_dispute_resolution(&challenger, &fixture.market_id, &9),
        Err(Ok(Error::DisputeBondTooSmall))
    );
    assert_eq!(fixture.token_client.balance(&challenger), 10);
}

#[test]
fn test_categorical_input_and_outcome_validation() {
    let (env, _, client) = setup_initialized();
    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let resolver = Address::generate(&env);
    let token_issuer = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_issuer)
        .address();
    StellarAssetClient::new(&env, &token).mint(&creator, &2_000);
    let duplicate = Vec::from_array(
        &env,
        [
            String::from_str(&env, "same"),
            String::from_str(&env, "same"),
        ],
    );
    let deadline = env.ledger().timestamp() + 100;
    assert_eq!(
        client.try_create_categorical_market(
            &creator,
            &String::from_str(&env, "Duplicate labels"),
            &duplicate,
            &deadline,
            &oracle,
            &resolver,
            &token,
            &10,
            &1_000,
        ),
        Err(Ok(Error::InvalidOutcome))
    );

    let fixture = setup_conditional(3);
    assert_eq!(
        fixture.client.try_quote_buy(&fixture.market_id, &3, &100),
        Err(Ok(Error::InvalidOutcome))
    );
}

#[test]
fn test_legacy_market_api_remains_available() {
    let (env, _, client) = setup_initialized();
    let (_, _, market_id) = create_market_helper(&env, &client, 0);
    let trader = Address::generate(&env);
    client.place_bet(&trader, &market_id, &1, &100);
    client.resolve_market(&market_id, &1);
    assert_eq!(client.calculate_payout(&market_id, &trader), 100);
}

#[test]
fn test_spot_price_extreme_reserves() {
    let fixture = setup_conditional(2);
    let buyer = Address::generate(&fixture.env);
    fixture.token_admin.mint(&buyer, &100_000);

    fixture
        .client
        .buy_shares(&buyer, &fixture.market_id, &1, &50_000, &1);

    let price_yes = fixture.client.spot_price(&fixture.market_id, &1);
    let price_no = fixture.client.spot_price(&fixture.market_id, &0);

    assert!(price_yes > 9_500);
    assert!(price_no < 500);
    assert!(price_yes + price_no <= 10_001);
}

#[test]
fn test_dispute_resolution_bond_repayment_math() {
    let fixture = setup_conditional(2);
    let challenger = Address::generate(&fixture.env);
    fixture.token_admin.mint(&challenger, &1_000);

    fixture.env.ledger().set_timestamp(fixture.deadline);
    fixture.client.propose_resolution(&fixture.market_id, &0);

    let result = fixture.client.try_dispute_resolution(&challenger, &fixture.market_id, &9);
    assert!(result.is_err());

    fixture.client.dispute_resolution(&challenger, &fixture.market_id, &15);
    fixture.client.resolve_dispute(&fixture.market_id, &1);

    assert_eq!(fixture.token_client.balance(&challenger), 1_000);
}

#[test]
fn test_mint_complete_set_credits_every_outcome_and_merges_back() {
    let fixture = setup_conditional(3);
    let minter = Address::generate(&fixture.env);
    fixture.token_admin.mint(&minter, &400);

    fixture
        .client
        .mint_complete_set(&minter, &fixture.market_id, &200);
    assert_eq!(
        fixture
            .client
            .outcome_balance(&fixture.market_id, &minter, &0),
        200
    );
    assert_eq!(
        fixture
            .client
            .outcome_balance(&fixture.market_id, &minter, &1),
        200
    );
    assert_eq!(
        fixture
            .client
            .outcome_balance(&fixture.market_id, &minter, &2),
        200
    );
    assert_eq!(fixture.token_client.balance(&minter), 200);

    fixture
        .client
        .redeem_complete_set(&minter, &fixture.market_id, &200);
    assert_eq!(fixture.token_client.balance(&minter), 400);
    assert_eq!(
        fixture.client.get_conditional_market(&fixture.market_id).collateral_locked,
        1_000
    );
}

#[test]
fn test_sell_shares_is_inverse_of_buy_within_rounding() {
    let fixture = setup_conditional(2);
    let trader = Address::generate(&fixture.env);
    fixture.token_admin.mint(&trader, &500);

    let bought = fixture
        .client
        .buy_shares(&trader, &fixture.market_id, &1, &100, &1);
    let quote = fixture.client.quote_sell(&fixture.market_id, &1, &bought);
    let received = fixture
        .client
        .sell_shares(&trader, &fixture.market_id, &1, &bought, &quote);

    assert_eq!(received, quote);
    assert!(received <= 100);
    assert!(received >= 90);
    assert_eq!(
        fixture
            .client
            .outcome_balance(&fixture.market_id, &trader, &1),
        0
    );
}

#[test]
fn test_sell_shares_slippage_and_balance_guards() {
    let fixture = setup_conditional(2);
    let trader = Address::generate(&fixture.env);
    fixture.token_admin.mint(&trader, &200);
    fixture
        .client
        .buy_shares(&trader, &fixture.market_id, &0, &50, &1);

    assert_eq!(
        fixture
            .client
            .try_sell_shares(&trader, &fixture.market_id, &0, &10, &10_000),
        Err(Ok(Error::SlippageExceeded))
    );
    assert_eq!(
        fixture
            .client
            .try_sell_shares(&trader, &fixture.market_id, &1, &1, &1),
        Err(Ok(Error::InsufficientShares))
    );
}

#[test]
fn test_legacy_resolve_is_blocked_on_conditional_markets() {
    let fixture = setup_conditional(2);
    assert_eq!(
        fixture.client.try_resolve_market(&fixture.market_id, &1),
        Err(Ok(Error::ConditionalMarketRequired))
    );
    assert_eq!(
        fixture.client.try_cancel_market(&fixture.market_id),
        Err(Ok(Error::ConditionalMarketRequired))
    );
}

#[test]
fn test_second_dispute_and_closed_window_are_rejected() {
    let fixture = setup_conditional(2);
    let first = Address::generate(&fixture.env);
    let second = Address::generate(&fixture.env);
    fixture.token_admin.mint(&first, &50);
    fixture.token_admin.mint(&second, &50);
    fixture.env.ledger().set_timestamp(fixture.deadline);
    fixture.client.propose_resolution(&fixture.market_id, &1);
    fixture
        .client
        .dispute_resolution(&first, &fixture.market_id, &20);
    assert_eq!(
        fixture
            .client
            .try_dispute_resolution(&second, &fixture.market_id, &20),
        Err(Ok(Error::ResolutionAlreadyDisputed))
    );
    assert_eq!(
        fixture.client.try_finalize_resolution(&fixture.market_id),
        Err(Ok(Error::ResolutionAlreadyDisputed))
    );
}
