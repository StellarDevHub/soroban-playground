// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events},
    vec, Env, IntoVal, Symbol, TryFromVal,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, LendingProtocolClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LendingProtocol);
    let client = LendingProtocolClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

/// Force `user`'s position directly into an under-collateralized
/// (deposited, borrowed) state, bypassing `borrow()`'s 150% collateral
/// check via the crate-internal storage functions.
///
/// This contract has no price-oracle or interest-accrual mechanism that
/// could otherwise cause a position to drift under-collateralized after a
/// valid borrow (that happens in reality when collateral's market value
/// drops) — so `deposit()` + `borrow()` alone can never construct one:
/// `borrow()` always enforces the 150% ratio at call time. Liquidation
/// tests need this helper to reach a state the public API can't produce.
fn force_position(
    env: &Env,
    contract_id: &Address,
    user: &Address,
    deposited: i128,
    borrowed: i128,
) {
    env.as_contract(contract_id, || {
        crate::storage::set_position(
            env,
            user,
            &UserPosition {
                deposited,
                borrowed,
                last_updated: env.ledger().timestamp(),
                credit_score: 0,
            },
        );
        crate::storage::set_total_deposited(
            env,
            crate::storage::get_total_deposited(env) + deposited,
        );
        crate::storage::set_total_borrowed(env, crate::storage::get_total_borrowed(env) + borrowed);
    });
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, _admin, _client) = setup();
    // If we get here without panic the contract initialised correctly.
}

#[test]
fn test_double_initialize_fails() {
    let (_env, admin, client) = setup();
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Deposit ───────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_increases_balance() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &1_000);
    let pos = client.get_user_position(&user);
    assert_eq!(pos.deposited, 1_000);
    assert_eq!(pos.borrowed, 0);
}

#[test]
fn test_deposit_updates_pool_stats() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &500);
    let stats = client.get_stats();
    assert_eq!(stats.total_deposited, 500);
}

#[test]
fn test_deposit_zero_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let result = client.try_deposit(&user, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_deposit_negative_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let result = client.try_deposit(&user, &-1);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

// ── Withdraw ──────────────────────────────────────────────────────────────────

#[test]
fn test_withdraw_reduces_balance() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &1_000);
    client.withdraw(&user, &400);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.deposited, 600);
}

#[test]
fn test_withdraw_more_than_deposited_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &100);
    let result = client.try_withdraw(&user, &200);
    assert_eq!(result, Err(Ok(Error::InsufficientBalance)));
}

#[test]
fn test_withdraw_zero_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &100);
    let result = client.try_withdraw(&user, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_withdraw_breaches_collateral_ratio_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    // Deposit 150, borrow 100 → ratio = 150 %.
    client.deposit(&user, &150);
    client.borrow(&user, &100);

    // Withdrawing any amount would drop below 150 % ratio.
    let result = client.try_withdraw(&user, &1);
    assert_eq!(result, Err(Ok(Error::InsufficientCollateral)));
}

#[test]
fn test_withdraw_allowed_when_no_borrow() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &500);
    client.withdraw(&user, &500);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.deposited, 0);
}

// ── Borrow ────────────────────────────────────────────────────────────────────

#[test]
fn test_borrow_within_collateral_ok() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    // Deposit 150, borrow 100 → exactly at 150 % ratio.
    client.deposit(&user, &150);
    client.borrow(&user, &100);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 100);
}

#[test]
fn test_borrow_exceeds_collateral_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &100);
    // 101 * 150 > 100 * 100 → reject.
    let result = client.try_borrow(&user, &101);
    assert_eq!(result, Err(Ok(Error::InsufficientCollateral)));
}

#[test]
fn test_borrow_zero_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &100);
    let result = client.try_borrow(&user, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_borrow_negative_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &100);
    let result = client.try_borrow(&user, &-50);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_borrow_updates_pool_stats() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &300);
    client.borrow(&user, &100);

    let stats = client.get_stats();
    assert_eq!(stats.total_borrowed, 100);
    assert_eq!(stats.total_deposited, 300);
}

// ── Repay ─────────────────────────────────────────────────────────────────────

#[test]
fn test_repay_reduces_borrow() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &300);
    client.borrow(&user, &100);
    let actual = client.repay(&user, &40);

    assert_eq!(actual, 40);
    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 60);
}

#[test]
fn test_repay_increments_credit_score() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &300);
    client.borrow(&user, &100);
    client.repay(&user, &20);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.credit_score, 5);
}

#[test]
fn test_repay_capped_at_outstanding_balance() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &300);
    client.borrow(&user, &50);

    // Repay more than owed — should be capped at 50.
    let actual = client.repay(&user, &200);
    assert_eq!(actual, 50);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 0);
}

#[test]
fn test_repay_zero_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &100);
    client.borrow(&user, &50);
    let result = client.try_repay(&user, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_repay_nothing_borrowed_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    client.deposit(&user, &100);
    // No borrow → actual_repay = 0 → InvalidAmount.
    let result = client.try_repay(&user, &10);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_repay_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LendingProtocol);
    let client = LendingProtocolClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let user = Address::generate(&env);
    client.deposit(&user, &300);
    client.borrow(&user, &100);
    client.repay(&user, &20);

    // soroban_sdk::Val (the type of raw event topics/data) doesn't implement
    // PartialEq in this SDK version, so comparing the event tuple directly
    // (as the previous version of this test did) is a compile error —
    // decode each Val back into a concrete, comparable type instead.
    let last_event = env.events().all().last().unwrap();
    assert_eq!(last_event.0, contract_id);
    let (repaid, credit): (i128, i128) = soroban_sdk::FromVal::from_val(&env, &last_event.2);
    assert_eq!(repaid, 20);
    assert_eq!(credit, 5);
}

fn setup_position(
    env: &Env,
    contract_id: &Address,
    user: &Address,
    deposited: i128,
    borrowed: i128,
) {
    env.as_contract(contract_id, || {
        set_position(
            env,
            user,
            &UserPosition {
                deposited,
                borrowed,
                last_updated: env.ledger().timestamp(),
                credit_score: 0,
            },
        );
        set_total_deposited(env, get_total_deposited(env) + deposited);
        set_total_borrowed(env, get_total_borrowed(env) + borrowed);
    });
}

// ── Liquidate ─────────────────────────────────────────────────────────────────

#[test]
fn test_liquidate_undercollateralised_position() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    // Setup 100 deposited, 100 borrowed → borrowed * 110 = 11000 > deposited * 100 = 10000.
    setup_position(&env, &client.address, &user, 100, 100);
    // deposited=100, borrowed=100 → borrowed * 110 = 11000 > deposited * 100 = 10000.
    // borrow()'s own 150% check can never leave a position this thin, so
    // this is forced directly — see force_position's doc comment.
    force_position(&env, &client.address, &user, 100, 100);

    let seized = client.liquidate(&liquidator, &user, &50);
    // 50 * 110 / 100 = 55 collateral seized.
    assert_eq!(seized, 55);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 50);
    assert_eq!(pos.deposited, 45); // 100 - 55

    let liq_pos = client.get_user_position(&liquidator);
    assert_eq!(liq_pos.deposited, 55);
}

#[test]
fn test_liquidate_healthy_position_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    // Deposit 300, borrow 100 → healthy (300 % collateral).
    client.deposit(&user, &300);
    client.borrow(&user, &100);

    let result = client.try_liquidate(&liquidator, &user, &50);
    assert_eq!(result, Err(Ok(Error::PositionNotUndercollateralized)));
}

#[test]
fn test_liquidate_no_borrow_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    client.deposit(&user, &100);
    let result = client.try_liquidate(&liquidator, &user, &10);
    assert_eq!(result, Err(Ok(Error::NothingToLiquidate)));
}

#[test]
fn test_liquidate_exceeds_borrow_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    setup_position(&env, &client.address, &user, 100, 100);
    force_position(&env, &client.address, &user, 100, 100);

    // Try to liquidate more than the outstanding debt.
    let result = client.try_liquidate(&liquidator, &user, &200);
    assert_eq!(result, Err(Ok(Error::LiquidationExceedsBorrow)));
}

#[test]
fn test_liquidate_zero_amount_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    setup_position(&env, &client.address, &user, 100, 100);
    force_position(&env, &client.address, &user, 100, 100);

    let result = client.try_liquidate(&liquidator, &user, &0);
    assert_eq!(result, Err(Ok(Error::InvalidAmount)));
}

#[test]
fn test_liquidate_updates_pool_stats() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    let liquidator = Address::generate(&env);

    setup_position(&env, &client.address, &user, 100, 100);
    force_position(&env, &client.address, &user, 100, 100);
    client.liquidate(&liquidator, &user, &50);

    let stats = client.get_stats();
    assert_eq!(stats.total_borrowed, 50);
    // total_deposited reduced by seized collateral (55).
    assert_eq!(stats.total_deposited, 45);
}

// ── Pool stats ────────────────────────────────────────────────────────────────

#[test]
fn test_stats_interest_rate_calculation() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &1_000);
    client.borrow(&user, &500);

    let stats = client.get_stats();
    // Utilisation = 500 / 1000 = 50 % → 5000 bps.
    assert_eq!(stats.interest_rate, 5_000);
}

#[test]
fn test_stats_zero_deposit_rate_is_zero() {
    let (_env, _admin, client) = setup();
    let stats = client.get_stats();
    assert_eq!(stats.interest_rate, 0);
}

// ── Credit scoring ────────────────────────────────────────────────────────────

#[test]
fn test_credit_score_accumulates_across_repayments() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    client.deposit(&user, &1_000);
    client.borrow(&user, &300);

    client.repay(&user, &50);
    client.repay(&user, &50);
    client.repay(&user, &50);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.credit_score, 15); // 3 × 5
}

// ── Uninitialized & Borrow Edge Cases ─────────────────────────────────────────

#[test]
fn test_uninitialized_contract_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LendingProtocol);
    let client = LendingProtocolClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    assert_eq!(
        client.try_deposit(&user, &100),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_borrow(&user, &50),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_withdraw(&user, &50),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(client.try_repay(&user, &50), Err(Ok(Error::NotInitialized)));
}

#[test]
fn test_borrow_without_deposit_fails() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    let result = client.try_borrow(&user, &100);
    assert_eq!(result, Err(Ok(Error::InsufficientCollateral)));
}

#[test]
fn test_borrow_exact_collateral_boundary() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    // Deposit 300, borrow 200: 200 * 150 = 30000 <= 300 * 100 = 30000 -> OK
    client.deposit(&user, &300);
    client.borrow(&user, &200);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 200);
}

#[test]
fn test_borrow_successive_accumulating_borrows() {
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);

    // Deposit 600 -> Max borrowable = 400
    client.deposit(&user, &600);
    client.borrow(&user, &150);
    client.borrow(&user, &150);
    client.borrow(&user, &100);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 400);

    // 1 more borrow exceeds 150% collateral ratio
    let res = client.try_borrow(&user, &1);
    assert_eq!(res, Err(Ok(Error::InsufficientCollateral)));
}

#[test]
fn test_liquidate_rejects_self_liquidation() {
    // Before the fix: a borrower could pass their own address as both
    // `liquidator` and `user`. Collateral seized from `user` and collateral
    // credited to `liquidator` are the same storage slot when the two
    // addresses are equal, so the seizure netted to zero while the debt
    // reduction was real — erasing debt for free with no actual repayment.
    let (env, _admin, client) = setup();
    let user = Address::generate(&env);
    force_position(&env, &client.address, &user, 100, 100);

    let result = client.try_liquidate(&user, &user, &50);
    assert_eq!(result, Err(Ok(Error::SelfLiquidationNotAllowed)));

    // Position must be completely untouched by the rejected attempt.
    let pos = client.get_user_position(&user);
    assert_eq!(pos.borrowed, 100);
    assert_eq!(pos.deposited, 100);
}
