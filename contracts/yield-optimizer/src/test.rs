// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

use crate::types::Error;
use crate::{YieldOptimizer, YieldOptimizerClient};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/// Create a standard "Delta Neutral Vault" strategy and return its ID.
fn add_strategy(env: &Env, client: &YieldOptimizerClient, admin: &Address) -> u32 {
    client.create_strategy(
        admin,
        &String::from_str(env, "Delta Neutral Vault"),
        &String::from_str(env, "Blend Capital + Wave AMM"),
        &1200,   // 12 % APY
        &300,    // 3 % fee
        &86_400, // compound every 24 h
    )
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, admin, _executor, client) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(!client.paused());
    assert_eq!(client.strategy_count(), 0);
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, executor, client) = setup();
    let result = client.try_initialize(&admin, &executor);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Strategy management ───────────────────────────────────────────────────────

#[test]
fn test_methods_fail_before_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, YieldOptimizer);
    let client = YieldOptimizerClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let executor = Address::generate(&env);
    let user = Address::generate(&env);

    assert_eq!(client.try_get_admin(), Err(Ok(Error::NotInitialized)));
    assert_eq!(client.try_get_executor(), Err(Ok(Error::NotInitialized)));
    assert_eq!(
        client.try_create_strategy(
            &admin,
            &String::from_str(&env, "Vault"),
            &String::from_str(&env, "Protocol"),
            &1000,
            &200,
            &86_400,
        ),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_deposit(&user, &1, &1_000),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_compound(&executor, &1),
        Err(Ok(Error::NotInitialized))
    );
}

#[test]
fn test_create_strategy_stores_data() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let strategy = client.get_strategy(&strategy_id);

    assert_eq!(strategy.name, String::from_str(&env, "Delta Neutral Vault"));
    assert_eq!(strategy.apy_bps, 1200);
    assert_eq!(strategy.fee_bps, 300);
    assert_eq!(strategy.compound_interval, 86_400);
    assert!(strategy.is_active);
    assert_eq!(strategy.total_deposited, 0);
    assert_eq!(strategy.total_shares, 0);
}

#[test]
fn test_create_strategy_increments_count() {
    let (env, admin, _executor, client) = setup();
    add_strategy(&env, &client, &admin);
    assert_eq!(client.strategy_count(), 1);
    add_strategy(&env, &client, &admin);
    assert_eq!(client.strategy_count(), 2);
}

#[test]
fn test_create_strategy_non_admin_fails() {
    let (env, _admin, _executor, client) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_create_strategy(
        &stranger,
        &String::from_str(&env, "Vault"),
        &String::from_str(&env, "Protocol"),
        &1000,
        &200,
        &86_400,
    );
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_create_strategy_invalid_apy_fails() {
    let (env, admin, _executor, client) = setup();
    // MAX_APY_BPS = 20_000; 20_001 should fail.
    let result = client.try_create_strategy(
        &admin,
        &String::from_str(&env, "Vault"),
        &String::from_str(&env, "Protocol"),
        &20_001,
        &200,
        &86_400,
    );
    assert_eq!(result, Err(Ok(Error::InvalidApy)));
}

#[test]
fn test_create_strategy_invalid_fee_fails() {
    let (env, admin, _executor, client) = setup();
    // MAX_FEE_BPS = 2_500; 2_501 should fail.
    let result = client.try_create_strategy(
        &admin,
        &String::from_str(&env, "Vault"),
        &String::from_str(&env, "Protocol"),
        &1000,
        &2_501,
        &86_400,
    );
    assert_eq!(result, Err(Ok(Error::InvalidFee)));
}

#[test]
fn test_create_strategy_zero_interval_fails() {
    let (env, admin, _executor, client) = setup();
    let result = client.try_create_strategy(
        &admin,
        &String::from_str(&env, "Vault"),
        &String::from_str(&env, "Protocol"),
        &1000,
        &200,
        &0,
    );
    assert_eq!(result, Err(Ok(Error::InvalidInterval)));
}

#[test]
fn test_create_strategy_empty_name_fails() {
    let (env, admin, _executor, client) = setup();
    let result = client.try_create_strategy(
        &admin,
        &String::from_str(&env, ""),
        &String::from_str(&env, "Protocol"),
        &1000,
        &200,
        &86_400,
    );
    assert_eq!(result, Err(Ok(Error::EmptyName)));
}

#[test]
fn test_create_strategy_empty_protocol_fails() {
    let (env, admin, _executor, client) = setup();
    let result = client.try_create_strategy(
        &admin,
        &String::from_str(&env, "Vault"),
        &String::from_str(&env, ""),
        &1000,
        &200,
        &86_400,
    );
    assert_eq!(result, Err(Ok(Error::InvalidProtocol)));
}

#[test]
fn test_update_strategy() {
    let (env, admin, _executor, client) = setup();
    let id = add_strategy(&env, &client, &admin);

    client.update_strategy(&admin, &id, &800, &100, &3_600, &true);
    let s = client.get_strategy(&id);
    assert_eq!(s.apy_bps, 800);
    assert_eq!(s.fee_bps, 100);
    assert_eq!(s.compound_interval, 3_600);
}

#[test]
fn test_update_strategy_non_admin_fails() {
    let (env, admin, _executor, client) = setup();
    let id = add_strategy(&env, &client, &admin);
    let stranger = Address::generate(&env);

    let result = client.try_update_strategy(&stranger, &id, &900, &100, &3_600, &true);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_update_strategy_invalid_params_fail() {
    let (env, admin, _executor, client) = setup();
    let id = add_strategy(&env, &client, &admin);

    assert_eq!(
        client.try_update_strategy(&admin, &id, &20_001, &100, &3_600, &true),
        Err(Ok(Error::InvalidApy))
    );
    assert_eq!(
        client.try_update_strategy(&admin, &id, &900, &2_501, &3_600, &true),
        Err(Ok(Error::InvalidFee))
    );
    assert_eq!(
        client.try_update_strategy(&admin, &id, &900, &100, &0, &true),
        Err(Ok(Error::InvalidInterval))
    );
}

#[test]
fn test_deactivate_strategy() {
    let (env, admin, _executor, client) = setup();
    let id = add_strategy(&env, &client, &admin);

    client.update_strategy(&admin, &id, &1200, &300, &86_400, &false);
    assert!(!client.get_strategy(&id).is_active);
}

#[test]
fn test_get_nonexistent_strategy_fails() {
    let (_env, _admin, _executor, client) = setup();
    let result = client.try_get_strategy(&999);
    assert_eq!(result, Err(Ok(Error::StrategyNotFound)));
}

#[test]
fn test_list_strategies() {
    let (env, admin, _executor, client) = setup();
    add_strategy(&env, &client, &admin);
    add_strategy(&env, &client, &admin);
    let list = client.list_strategies();
    assert_eq!(list.len(), 2);
}

// ── Deposit ───────────────────────────────────────────────────────────────────

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
    assert_eq!(position.principal, 5_000_000);
    assert_eq!(position.current_balance, 5_000_000);
    assert_eq!(strategy.total_deposited, 5_000_000);
    assert_eq!(strategy.total_shares, 5_000_000);
}

#[test]
fn test_deposit_zero_fails() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    let result = client.try_deposit(&user, &strategy_id, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_deposit_negative_fails() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    let result = client.try_deposit(&user, &strategy_id, &-1);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_deposit_into_inactive_strategy_fails() {
    let (env, admin, _executor, client) = setup();
    let id = add_strategy(&env, &client, &admin);
    client.update_strategy(&admin, &id, &1200, &300, &86_400, &false);

    let user = Address::generate(&env);
    let result = client.try_deposit(&user, &id, &1_000);
    assert_eq!(result, Err(Ok(Error::StrategyPaused)));
}

#[test]
fn test_deposit_into_nonexistent_strategy_fails() {
    let (env, _admin, _executor, client) = setup();
    let user = Address::generate(&env);
    let result = client.try_deposit(&user, &999, &1_000);
    assert_eq!(result, Err(Ok(Error::StrategyNotFound)));
}

#[test]
fn test_multiple_deposits_accumulate() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &strategy_id, &3_000_000);
    client.deposit(&user, &strategy_id, &2_000_000);

    let position = client.get_position(&user, &strategy_id);
    assert_eq!(position.principal, 5_000_000);
    assert_eq!(position.current_balance, 5_000_000);
}

// ── Withdraw ──────────────────────────────────────────────────────────────────

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
fn test_withdraw_zero_fails() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &strategy_id, &1_000_000);
    let result = client.try_withdraw(&user, &strategy_id, &0);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_withdraw_more_than_balance_fails() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &strategy_id, &1_000_000);
    let result = client.try_withdraw(&user, &strategy_id, &2_000_000);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_full_withdrawal_removes_position() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &strategy_id, &1_000_000);
    client.withdraw(&user, &strategy_id, &1_000_000);

    // Position should be gone.
    let result = client.try_get_position(&user, &strategy_id);
    assert_eq!(result, Err(Ok(Error::NoPosition)));
}

#[test]
fn test_withdraw_no_position_fails() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    let result = client.try_withdraw(&user, &strategy_id, &1_000);
    assert_eq!(result, Err(Ok(Error::NoPosition)));
}

// ── Withdrawal edge cases ─────────────────────────────────────────────────────

#[test]
fn test_withdraw_from_inactive_strategy_still_allows_exit() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &strategy_id, &1_000_000);
    client.update_strategy(&admin, &strategy_id, &1200, &300, &86_400, &false);

    let withdrawn = client.withdraw(&user, &strategy_id, &400_000);
    assert_eq!(withdrawn, 400_000);
    assert_eq!(
        client.get_position(&user, &strategy_id).current_balance,
        600_000
    );
}

// ── Compound ──────────────────────────────────────────────────────────────────

#[test]
fn test_compound_by_executor_increases_tvl() {
    let (env, admin, executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &strategy_id, &10_000_000);

    advance(&env, 172_800); // 2 days

    let new_tvl = client.compound(&executor, &strategy_id);
    assert!(new_tvl > 10_000_000);
    assert!(client.get_position(&user, &strategy_id).current_balance > 10_000_000);
}

#[test]
fn test_compound_by_admin_ok() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &strategy_id, &10_000_000);

    advance(&env, 172_800);
    let new_tvl = client.compound(&admin, &strategy_id);
    assert!(new_tvl > 10_000_000);
}

#[test]
fn test_compound_empty_strategy_keeps_zero_tvl() {
    let (env, admin, executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);

    advance(&env, 172_800);

    let new_tvl = client.compound(&executor, &strategy_id);
    let strategy = client.get_strategy(&strategy_id);
    assert_eq!(new_tvl, 0);
    assert_eq!(strategy.total_deposited, 0);
    assert_eq!(strategy.total_shares, 0);
}

#[test]
fn test_compound_too_soon_fails() {
    let (env, admin, executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);
    client.deposit(&user, &strategy_id, &1_000_000);

    // No time has passed — compound interval not reached.
    let result = client.try_compound(&executor, &strategy_id);
    assert_eq!(result, Err(Ok(Error::CompoundTooSoon)));
}

#[test]
fn test_compound_unauthorized_fails() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let stranger = Address::generate(&env);

    advance(&env, 172_800);
    let result = client.try_compound(&stranger, &strategy_id);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_compound_respects_fee() {
    let (env, admin, executor, client) = setup();
    assert_eq!(
        client.try_create_strategy(
            &admin,
            &String::from_str(&env, "High Fee Vault"),
            &String::from_str(&env, "Protocol"),
            &1000,
            &5000,
            &86_400,
        ),
        Err(Ok(Error::InvalidFee))
    );

    // MAX_FEE_BPS is 2500, so use a valid fee.
    let id2 = client.create_strategy(
        &admin,
        &String::from_str(&env, "Fee Vault"),
        &String::from_str(&env, "Protocol"),
        &1000,
        &2500, // 25 % fee
        &86_400,
    );

    let user = Address::generate(&env);
    client.deposit(&user, &id2, &10_000_000);

    advance(&env, 365 * 86_400); // 1 year

    let new_tvl = client.compound(&executor, &id2);
    // Net reward = gross * (1 - 0.25) = 10_000_000 * 0.10 * 0.75 = 750_000
    // TVL should be approximately 10_750_000.
    assert!(new_tvl > 10_000_000);
    assert!(new_tvl < 11_000_000); // sanity upper bound
}

// ── Pause / Unpause ───────────────────────────────────────────────────────────

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
fn test_pause_blocks_withdraw() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.deposit(&user, &strategy_id, &1_000_000);
    client.pause(&admin);

    let result = client.try_withdraw(&user, &strategy_id, &500_000);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_unpause_restores_operations() {
    let (env, admin, _executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);
    let user = Address::generate(&env);

    client.pause(&admin);
    client.unpause(&admin);

    // Should succeed after unpause.
    client.deposit(&user, &strategy_id, &1_000_000);
    let pos = client.get_position(&user, &strategy_id);
    assert_eq!(pos.current_balance, 1_000_000);
}

#[test]
fn test_only_admin_can_pause() {
    let (env, _admin, _executor, client) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_pause(&stranger);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_only_admin_can_unpause() {
    let (env, admin, _executor, client) = setup();
    let stranger = Address::generate(&env);
    client.pause(&admin);
    let result = client.try_unpause(&stranger);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Executor management ───────────────────────────────────────────────────────

#[test]
fn test_set_executor() {
    let (env, admin, _executor, client) = setup();
    let new_executor = Address::generate(&env);
    client.set_executor(&admin, &new_executor);
    assert_eq!(client.get_executor(), new_executor);
}

#[test]
fn test_set_executor_non_admin_fails() {
    let (env, _admin, _executor, client) = setup();
    let stranger = Address::generate(&env);
    let new_executor = Address::generate(&env);
    let result = client.try_set_executor(&stranger, &new_executor);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Share price mechanics ─────────────────────────────────────────────────────

#[test]
fn test_share_price_increases_after_compound() {
    let (env, admin, executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // User1 deposits before compound.
    client.deposit(&user1, &strategy_id, &10_000_000);

    advance(&env, 172_800);
    client.compound(&executor, &strategy_id);

    // User2 deposits after compound — should receive fewer shares for same amount.
    let shares2 = client.deposit(&user2, &strategy_id, &10_000_000);
    let shares1 = client.get_position(&user1, &strategy_id).shares;

    // User1 has more shares because they deposited before the price increase.
    assert!(shares1 > shares2);
}

#[test]
fn test_two_users_proportional_balances() {
    let (env, admin, executor, client) = setup();
    let strategy_id = add_strategy(&env, &client, &admin);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    client.deposit(&user1, &strategy_id, &10_000_000);
    client.deposit(&user2, &strategy_id, &10_000_000);

    advance(&env, 172_800);
    client.compound(&executor, &strategy_id);

    let bal1 = client.get_position(&user1, &strategy_id).current_balance;
    let bal2 = client.get_position(&user2, &strategy_id).current_balance;

    // Both deposited equal amounts → equal balances after compound.
    assert_eq!(bal1, bal2);
    assert!(bal1 > 10_000_000);
}
