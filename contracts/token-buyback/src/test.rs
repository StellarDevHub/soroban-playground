#![cfg(test)]

use super::{TokenBuyback, TokenBuybackClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn setup() -> (Env, Address, TokenBuybackClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenBuyback);
    let client = TokenBuybackClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (env, admin, client) = setup();
    let token = Address::generate(&env);

    let result = client.try_initialize(&admin, &token, &500, &100, &10_000, &3600);
    assert!(result.is_ok());
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, client) = setup();
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &500, &100, &10_000, &3600);
    let result = client.try_initialize(&admin, &token, &500, &100, &10_000, &3600);
    assert!(result.is_err());
}

#[test]
fn test_get_config() {
    let (env, admin, client) = setup();
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &500, &100, &10_000, &3600);
    let config = client.get_config();
    assert_eq!(config.buyback_bps, 500);
    assert_eq!(config.min_buyback_amount, 100);
    assert_eq!(config.max_buyback_amount, 10_000);
    assert_eq!(config.frequency_seconds, 3600);
    assert!(!config.paused);
}

#[test]
fn test_get_stats_initial() {
    let (env, admin, client) = setup();
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &500, &100, &10_000, &3600);
    let stats = client.get_stats();
    assert_eq!(stats.total_purchased, 0);
    assert_eq!(stats.total_burned, 0);
    assert_eq!(stats.buyback_count, 0);
}

#[test]
fn test_set_paused() {
    let (env, admin, client) = setup();
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &500, &100, &10_000, &3600);
    client.set_paused(&admin, &true);
    let config = client.get_config();
    assert!(config.paused);

    client.set_paused(&admin, &false);
    let config = client.get_config();
    assert!(!config.paused);
}

#[test]
fn test_update_config() {
    let (env, admin, client) = setup();
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &500, &100, &10_000, &3600);
    client.update_config(&admin, &1000, &200, &20_000, &7200);
    let config = client.get_config();
    assert_eq!(config.buyback_bps, 1000);
    assert_eq!(config.min_buyback_amount, 200);
    assert_eq!(config.max_buyback_amount, 20_000);
    assert_eq!(config.frequency_seconds, 7200);
}

#[test]
fn test_treasury_balance_initial() {
    let (env, admin, client) = setup();
    let token = Address::generate(&env);

    client.initialize(&admin, &token, &500, &100, &10_000, &3600);
    assert_eq!(client.get_treasury_balance(), 0);
}
