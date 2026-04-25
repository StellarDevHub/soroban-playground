#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{PredictionMarket, PredictionMarketClient};
use crate::types::{Error, MarketStatus, MarketType};

fn setup() -> (Env, Address, PredictionMarketClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PredictionMarket);
    let client = PredictionMarketClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    assert!(client.is_initialized());
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_create_binary_market() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Will BTC exceed $100k by end of 2025?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    assert_eq!(market_id, 1);

    let market = client.get_market(&market_id);
    assert_eq!(market.id, 1);
    assert_eq!(market.market_type, MarketType::Binary);
    assert_eq!(market.status, MarketStatus::Open);
    assert_eq!(market.total_yes_stake, 0);
    assert_eq!(market.total_no_stake, 0);
}

#[test]
fn test_create_scalar_market() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "What will ETH price be at end of Q1?");

    let market_id = client.create_market(&creator, &question, &1u32, &deadline, &oracle);
    let market = client.get_market(&market_id);
    assert_eq!(market.market_type, MarketType::Scalar);
}

#[test]
fn test_create_market_invalid_type_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let result = client.try_create_market(&creator, &question, &99u32, &deadline, &oracle);
    assert_eq!(result, Err(Ok(Error::InvalidMarketType)));
}

#[test]
fn test_place_bet_yes() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Will it rain tomorrow?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.place_bet(&trader, &market_id, &1u32, &500i128);

    let market = client.get_market(&market_id);
    assert_eq!(market.total_yes_stake, 500);
    assert_eq!(market.total_no_stake, 0);

    let pos = client.get_position(&market_id, &trader);
    assert_eq!(pos.stake, 500);
    assert_eq!(pos.outcome, 1);
}

#[test]
fn test_place_bet_no() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Will it rain tomorrow?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.place_bet(&trader, &market_id, &0u32, &300i128);

    let market = client.get_market(&market_id);
    assert_eq!(market.total_no_stake, 300);
}

#[test]
fn test_place_bet_accumulates() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.place_bet(&trader, &market_id, &1u32, &200i128);
    client.place_bet(&trader, &market_id, &1u32, &300i128);

    let pos = client.get_position(&market_id, &trader);
    assert_eq!(pos.stake, 500);
}

#[test]
fn test_place_bet_zero_stake_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    let result = client.try_place_bet(&trader, &market_id, &1u32, &0i128);
    assert_eq!(result, Err(Ok(Error::ZeroStake)));
}

#[test]
fn test_resolve_market() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.resolve_market(&market_id, &1u32);

    let market = client.get_market(&market_id);
    assert_eq!(market.status, MarketStatus::Resolved);
    assert_eq!(market.winning_outcome, Some(1));
}

#[test]
fn test_resolve_already_resolved_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.resolve_market(&market_id, &1u32);

    let result = client.try_resolve_market(&market_id, &0u32);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}

#[test]
fn test_calculate_payout_winner() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let yes_trader = Address::generate(&env);
    let no_trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.place_bet(&yes_trader, &market_id, &1u32, &500i128);
    client.place_bet(&no_trader, &market_id, &0u32, &500i128);

    client.resolve_market(&market_id, &1u32); // YES wins

    // YES trader gets full pool (500 YES + 500 NO = 1000, they had 500/500 = 100%)
    let payout = client.calculate_payout(&market_id, &yes_trader);
    assert_eq!(payout, 1000);

    // NO trader gets nothing
    let payout_loser = client.calculate_payout(&market_id, &no_trader);
    assert_eq!(payout_loser, 0);
}

#[test]
fn test_calculate_payout_proportional() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let trader_a = Address::generate(&env);
    let trader_b = Address::generate(&env);
    let no_trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    // trader_a: 300 YES, trader_b: 700 YES, no_trader: 500 NO
    client.place_bet(&trader_a, &market_id, &1u32, &300i128);
    client.place_bet(&trader_b, &market_id, &1u32, &700i128);
    client.place_bet(&no_trader, &market_id, &0u32, &500i128);

    client.resolve_market(&market_id, &1u32); // YES wins

    // total_pool = 1500, yes_pool = 1000
    // trader_a payout = 300 * 1500 / 1000 = 450
    // trader_b payout = 700 * 1500 / 1000 = 1050
    let payout_a = client.calculate_payout(&market_id, &trader_a);
    let payout_b = client.calculate_payout(&market_id, &trader_b);
    assert_eq!(payout_a, 450);
    assert_eq!(payout_b, 1050);
}

#[test]
fn test_cancel_market_refunds() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.place_bet(&trader, &market_id, &1u32, &400i128);
    client.cancel_market(&market_id);

    let market = client.get_market(&market_id);
    assert_eq!(market.status, MarketStatus::Cancelled);

    // Cancelled market returns full stake
    let payout = client.calculate_payout(&market_id, &trader);
    assert_eq!(payout, 400);
}

#[test]
fn test_market_count_increments() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let q = String::from_str(&env, "Q?");

    assert_eq!(client.market_count(), 0);
    client.create_market(&creator, &q, &0u32, &deadline, &oracle);
    assert_eq!(client.market_count(), 1);
    client.create_market(&creator, &q, &0u32, &deadline, &oracle);
    assert_eq!(client.market_count(), 2);
}

#[test]
fn test_bet_on_resolved_market_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    let creator = Address::generate(&env);
    let oracle = Address::generate(&env);
    let trader = Address::generate(&env);
    let deadline = env.ledger().timestamp() + 1000;
    let question = String::from_str(&env, "Test?");

    let market_id = client.create_market(&creator, &question, &0u32, &deadline, &oracle);
    client.resolve_market(&market_id, &1u32);

    let result = client.try_place_bet(&trader, &market_id, &1u32, &100i128);
    assert_eq!(result, Err(Ok(Error::MarketAlreadyResolved)));
}
