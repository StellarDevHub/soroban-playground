#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{SportsPredictionMarket, SportsPredictionMarketClient};
use crate::types::{Error, MarketStatus};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, Address, SportsPredictionMarketClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SportsPredictionMarket);
    let client = SportsPredictionMarketClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, oracle, client)
}

fn make_market(
    env: &Env,
    client: &SportsPredictionMarketClient,
    oracle: &Address,
) -> u32 {
    let creator = Address::generate(env);
    let deadline = env.ledger().timestamp() + 3600;
    client.create_market(
        &creator,
        &String::from_str(env, "Lakers vs Celtics"),
        &1u32, // Basketball
        &String::from_str(env, "Lakers"),
        &String::from_str(env, "Celtics"),
        &deadline,
        oracle,
        &18000u32, // 1.80x home
        &35000u32, // 3.50x draw
        &22000u32, // 2.20x away
    )
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (_, _, _, client) = setup();
    assert!(client.is_initialized());
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, _, client) = setup();
    let _ = env; // suppress warning
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Market creation ───────────────────────────────────────────────────────────

#[test]
fn test_create_market() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    assert_eq!(id, 1);
    let m = client.get_market(&id);
    assert_eq!(m.status, MarketStatus::Open);
    assert_eq!(m.odds_home_bp, 18000);
    assert_eq!(m.total_home_stake, 0);
}

#[test]
fn test_create_market_invalid_odds_fails() {
    let (env, _, oracle, client) = setup();
    let creator = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 3600;
    let result = client.try_create_market(
        &creator,
        &String::from_str(&env, "Test"),
        &0u32,
        &String::from_str(&env, "A"),
        &String::from_str(&env, "B"),
        &deadline,
        &oracle,
        &9000u32, // below minimum
        &20000u32,
        &20000u32,
    );
    assert_eq!(result, Err(Ok(Error::InvalidOdds)));
}

#[test]
fn test_market_count_increments() {
    let (env, _, oracle, client) = setup();
    assert_eq!(client.market_count(), 0);
    make_market(&env, &client, &oracle);
    assert_eq!(client.market_count(), 1);
    make_market(&env, &client, &oracle);
    assert_eq!(client.market_count(), 2);
}

// ── Betting ───────────────────────────────────────────────────────────────────

#[test]
fn test_place_bet_home() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let bettor = Address::generate(&env);
    client.place_bet(&bettor, &id, &0u32, &500i128);
    let m = client.get_market(&id);
    assert_eq!(m.total_home_stake, 500);
    let pos = client.get_position(&id, &bettor);
    assert_eq!(pos.stake, 500);
    assert_eq!(pos.odds_bp, 18000);
}

#[test]
fn test_place_bet_accumulates() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let bettor = Address::generate(&env);
    client.place_bet(&bettor, &id, &2u32, &200i128);
    client.place_bet(&bettor, &id, &2u32, &300i128);
    let pos = client.get_position(&id, &bettor);
    assert_eq!(pos.stake, 500);
}

#[test]
fn test_place_bet_zero_stake_fails() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let bettor = Address::generate(&env);
    let result = client.try_place_bet(&bettor, &id, &0u32, &0i128);
    assert_eq!(result, Err(Ok(Error::ZeroStake)));
}

#[test]
fn test_place_bet_invalid_outcome_fails() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let bettor = Address::generate(&env);
    let result = client.try_place_bet(&bettor, &id, &5u32, &100i128);
    assert_eq!(result, Err(Ok(Error::InvalidOutcome)));
}

#[test]
fn test_place_bet_switch_side_fails() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let bettor = Address::generate(&env);
    client.place_bet(&bettor, &id, &0u32, &100i128);
    let result = client.try_place_bet(&bettor, &id, &2u32, &100i128);
    assert_eq!(result, Err(Ok(Error::InvalidOutcome)));
}

// ── Odds update ───────────────────────────────────────────────────────────────

#[test]
fn test_update_odds() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    client.update_odds(&id, &20000u32, &30000u32, &25000u32);
    let m = client.get_market(&id);
    assert_eq!(m.odds_home_bp, 20000);
    assert_eq!(m.odds_draw_bp, 30000);
    assert_eq!(m.odds_away_bp, 25000);
}

// ── Resolution ────────────────────────────────────────────────────────────────

#[test]
fn test_resolve_market() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    client.resolve_market(&id, &0u32); // Home wins
    let m = client.get_market(&id);
    assert_eq!(m.status, MarketStatus::Resolved);
    assert_eq!(m.winning_outcome, Some(0));
}

#[test]
fn test_resolve_already_resolved_fails() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    client.resolve_market(&id, &0u32);
    let result = client.try_resolve_market(&id, &1u32);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

#[test]
fn test_bet_on_resolved_market_fails() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    client.resolve_market(&id, &0u32);
    let bettor = Address::generate(&env);
    let result = client.try_place_bet(&bettor, &id, &0u32, &100i128);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

// ── Payouts ───────────────────────────────────────────────────────────────────

#[test]
fn test_payout_winner_takes_all() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let home_bettor = Address::generate(&env);
    let away_bettor = Address::generate(&env);
    client.place_bet(&home_bettor, &id, &0u32, &600i128);
    client.place_bet(&away_bettor, &id, &2u32, &400i128);
    client.resolve_market(&id, &0u32); // Home wins
    // home_bettor: 600 * 1000 / 600 = 1000
    let payout = client.calculate_payout(&id, &home_bettor);
    assert_eq!(payout, 1000);
    let loser = client.calculate_payout(&id, &away_bettor);
    assert_eq!(loser, 0);
}

#[test]
fn test_payout_proportional() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    client.place_bet(&a, &id, &0u32, &300i128);
    client.place_bet(&b, &id, &0u32, &700i128);
    client.place_bet(&c, &id, &2u32, &500i128);
    client.resolve_market(&id, &0u32);
    // total=1500, home_pool=1000
    // a: 300*1500/1000=450, b: 700*1500/1000=1050
    assert_eq!(client.calculate_payout(&id, &a), 450);
    assert_eq!(client.calculate_payout(&id, &b), 1050);
    assert_eq!(client.calculate_payout(&id, &c), 0);
}

#[test]
fn test_payout_cancelled_refunds_stake() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let bettor = Address::generate(&env);
    client.place_bet(&bettor, &id, &1u32, &800i128);
    client.cancel_market(&id);
    let payout = client.calculate_payout(&id, &bettor);
    assert_eq!(payout, 800);
}

// ── Analytics ─────────────────────────────────────────────────────────────────

#[test]
fn test_pool_analytics() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    client.place_bet(&a, &id, &0u32, &5000i128);
    client.place_bet(&b, &id, &1u32, &3000i128);
    client.place_bet(&c, &id, &2u32, &2000i128);
    let (total, home_pct, draw_pct, away_pct) = client.get_pool_analytics(&id);
    assert_eq!(total, 10000);
    assert_eq!(home_pct, 5000); // 50%
    assert_eq!(draw_pct, 3000); // 30%
    assert_eq!(away_pct, 2000); // 20%
}

#[test]
fn test_pool_analytics_empty() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    let (total, h, d, a) = client.get_pool_analytics(&id);
    assert_eq!(total, 0);
    assert_eq!(h, 0);
    assert_eq!(d, 0);
    assert_eq!(a, 0);
}

// ── Pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_betting() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    client.pause();
    let bettor = Address::generate(&env);
    let result = client.try_place_bet(&bettor, &id, &0u32, &100i128);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_unpause_allows_betting() {
    let (env, _, oracle, client) = setup();
    let id = make_market(&env, &client, &oracle);
    client.pause();
    client.unpause();
    let bettor = Address::generate(&env);
    client.place_bet(&bettor, &id, &0u32, &100i128);
    let pos = client.get_position(&id, &bettor);
    assert_eq!(pos.stake, 100);
}
