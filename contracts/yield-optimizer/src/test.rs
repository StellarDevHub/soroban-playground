#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

use crate::{YieldOptimizer, YieldOptimizerClient};
use crate::types::Error;

fn setup() -> (Env, Address, Address, YieldOptimizerClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, YieldOptimizer);
    let client = YieldOptimizerClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let executor = Address::generate(&env);
    client.initialize(&admin, &executor);
    (env, admin, executor, client)
}

fn add_strategy(env: &Env, client: &YieldOptimizerClient, admin: &Address) -> u32 {
    client.create_strategy(
        admin,
        &String::from_str(env, "Delta Neutral Vault"),
        &String::from_str(env, "Blend Capital + Wave AMM"),
        &1200,
        &300,
        &86_400,
    )
}

#[test]
fn test_create_strategy_stores_data() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let strategy = client.get_strategy(&strategy_id);

    assert_eq!(strategy.name, String::from_str(&env, "Delta Neutral Vault"));
    assert_eq!(strategy.apy_bps, 1200);
    assert_eq!(strategy.fee_bps, 300);
    assert!(strategy.is_active);
}

#[test]
fn test_deposit_tracks_shares_and_balance() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    let shares = client.deposit(&user, &strategy_id, &5_000_000);
    let position = client.get_position(&user, &strategy_id);
    let strategy = client.get_strategy(&strategy_id);

    assert_eq!(shares, 5_000_000);
    assert_eq!(position.shares, 5_000_000);
    assert_eq!(position.current_balance, 5_000_000);
    assert_eq!(strategy.total_deposited, 5_000_000);
    assert_eq!(strategy.total_shares, 5_000_000);
}

#[test]
fn test_withdraw_reduces_value() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &strategy_id, &10_000_000);
    client.withdraw(&user, &strategy_id, &4_000_000);

    let position = client.get_position(&user, &strategy_id);
    assert_eq!(position.current_balance, 6_000_000);
}

#[test]
fn test_compound_by_executor_increases_tvl() {
    let (env, admin, executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &strategy_id, &10_000_000);

    env.ledger().with_mut(|ledger| ledger.timestamp += 172_800);

    let new_tvl = client.compound(&executor, &strategy_id);
    assert!(new_tvl > 10_000_000);
    assert!(client.get_position(&user, &strategy_id).current_balance > 10_000_000);
}

#[test]
fn test_unauthorized_compound_fails() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let stranger = Address::generate(&env);

    env.ledger().with_mut(|ledger| ledger.timestamp += 172_800);
    let result = client.try_compound(&stranger, &strategy_id);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_pause_blocks_deposit() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.pause(&admin);
    let result = client.try_deposit(&user, &strategy_id, &1_000_000);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_only_admin_can_pause() {
    let (env, _admin, _executor, client) = setup();
    let stranger = Address::generate(&env);

    let result = client.try_pause(&stranger);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_compound_too_soon_fails() {
    let (env, admin, executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &strategy_id, &1_000_000);

    let result = client.try_compound(&executor, &strategy_id);
    assert_eq!(result, Err(Ok(Error::CompoundTooSoon)));
}
