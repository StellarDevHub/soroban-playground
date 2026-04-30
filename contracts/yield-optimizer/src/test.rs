// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{YieldOptimizerContract, YieldOptimizerContractClient};

fn setup() -> (Env, Address, YieldOptimizerContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, YieldOptimizerContract);
    let client = YieldOptimizerContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    assert!(client.is_initialized());
    assert!(!client.is_paused());
    assert_eq!(client.vault_count(), 0);
    assert_eq!(client.protocol_count(), 0);
}

#[test]
#[should_panic]
fn test_double_initialize_fails() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
fn test_add_protocol_and_create_vault() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let pid = client.add_protocol(&admin, &String::from_str(&env, "AMM Pool"), &800);
    assert_eq!(pid, 1);
    let vid = client.create_vault(&admin, &String::from_str(&env, "Optimizer Vault A"), &pid);
    assert_eq!(vid, 1);
    let vault = client.get_vault(&vid);
    assert_eq!(vault.current_apy_bps, 800);
    assert!(vault.is_active);
}

#[test]
fn test_deposit_and_withdraw() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let pid = client.add_protocol(&admin, &String::from_str(&env, "Lending Pool"), &500);
    let vid = client.create_vault(&admin, &String::from_str(&env, "Vault B"), &pid);

    let user = Address::generate(&env);
    let bal = client.deposit(&user, &vid, &1_000_000);
    assert_eq!(bal, 1_000_000);

    let pos = client.get_position(&user, &vid);
    assert_eq!(pos.deposited, 1_000_000);

    let withdrawn = client.withdraw(&user, &vid, &500_000);
    assert_eq!(withdrawn, 500_000);

    let pos2 = client.get_position(&user, &vid);
    assert_eq!(pos2.compounded_balance, 500_000);
}

#[test]
fn test_compound_increases_tvl() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let pid = client.add_protocol(&admin, &String::from_str(&env, "DEX"), &1000);
    let vid = client.create_vault(&admin, &String::from_str(&env, "Vault C"), &pid);

    let user = Address::generate(&env);
    client.deposit(&user, &vid, &10_000_000);

    // Advance ledger time by ~1 year
    env.ledger().with_mut(|l| l.timestamp += 31_536_000);

    let rewards = client.compound(&vid);
    assert!(rewards > 0);

    let vault = client.get_vault(&vid);
    assert!(vault.total_deposited > 10_000_000);
    assert!(vault.total_compounded > 0);
}

#[test]
fn test_rebalance_vault() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let p1 = client.add_protocol(&admin, &String::from_str(&env, "Protocol A"), &400);
    let p2 = client.add_protocol(&admin, &String::from_str(&env, "Protocol B"), &900);
    let vid = client.create_vault(&admin, &String::from_str(&env, "Vault D"), &p1);

    client.rebalance_vault(&admin, &vid, &p2);
    let vault = client.get_vault(&vid);
    assert_eq!(vault.protocol_id, p2);
    assert_eq!(vault.current_apy_bps, 900);
}

#[test]
fn test_backtest_snapshot() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let pid = client.add_protocol(&admin, &String::from_str(&env, "Staking"), &600);
    let vid = client.create_vault(&admin, &String::from_str(&env, "Vault E"), &pid);

    let user = Address::generate(&env);
    client.deposit(&user, &vid, &5_000_000);

    let bt_id = client.record_backtest(&admin, &vid);
    assert_eq!(bt_id, 1);
    let bt = client.get_backtest(&bt_id);
    assert_eq!(bt.vault_id, vid);
    assert_eq!(bt.apy_bps, 600);
    assert_eq!(bt.tvl, 5_000_000);
}

#[test]
fn test_pause_blocks_deposits() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let pid = client.add_protocol(&admin, &String::from_str(&env, "P"), &300);
    let vid = client.create_vault(&admin, &String::from_str(&env, "V"), &pid);

    client.pause(&admin);
    assert!(client.is_paused());

    let user = Address::generate(&env);
    assert!(client.try_deposit(&user, &vid, &1_000_000).is_err());

    client.unpause(&admin);
    assert!(client.deposit(&user, &vid, &1_000_000) > 0);
}

#[test]
fn test_estimated_balance_grows_over_time() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let pid = client.add_protocol(&admin, &String::from_str(&env, "Yield"), &2000);
    let vid = client.create_vault(&admin, &String::from_str(&env, "V"), &pid);

    let user = Address::generate(&env);
    client.deposit(&user, &vid, &1_000_000);

    env.ledger().with_mut(|l| l.timestamp += 15_768_000); // ~6 months

    let est = client.estimated_balance(&user, &vid);
    assert!(est > 1_000_000);
}
