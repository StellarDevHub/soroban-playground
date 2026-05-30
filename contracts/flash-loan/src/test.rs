// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env};

fn setup() -> (Env, FlashLoanProviderClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, FlashLoanProvider);
    let client = FlashLoanProviderClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &1_000_000i128).unwrap();
    (env, client, admin)
}

#[test]
fn test_initialize_sets_liquidity() {
    let (_env, client, _admin) = setup();
    assert_eq!(client.get_liquidity(), 1_000_000);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin) = setup();
    assert!(client.try_initialize(&admin, &0i128).is_err());
}

#[test]
fn test_deposit_increases_liquidity() {
    let (_env, client, admin) = setup();
    client.deposit(&admin, &500_000i128).unwrap();
    assert_eq!(client.get_liquidity(), 1_500_000);
}

#[test]
fn test_deposit_zero_fails() {
    let (_env, client, admin) = setup();
    assert!(client.try_deposit(&admin, &0i128).is_err());
}

#[test]
fn test_withdraw_decreases_liquidity() {
    let (_env, client, admin) = setup();
    client.withdraw(&admin, &400_000i128).unwrap();
    assert_eq!(client.get_liquidity(), 600_000);
}

#[test]
fn test_withdraw_exceeds_balance_fails() {
    let (_env, client, admin) = setup();
    assert!(client.try_withdraw(&admin, &2_000_000i128).is_err());
}

#[test]
fn test_non_admin_cannot_deposit() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    assert!(client.try_deposit(&stranger, &100i128).is_err());
}

#[test]
fn test_flash_loan_charges_fee() {
    let (env, client, _admin) = setup();
    let receiver = Address::generate(&env);
    let before = client.get_liquidity();
    let stats = client.flash_loan(&receiver, &100_000i128).unwrap();
    // fee = 100_000 * 5 / 1000 = 500
    assert_eq!(client.get_liquidity(), before + 500);
    assert_eq!(stats.total_loans, 1);
    assert_eq!(stats.total_fees_collected, 500);
}

#[test]
fn test_flash_loan_insufficient_balance_fails() {
    let (env, client, _admin) = setup();
    let receiver = Address::generate(&env);
    assert!(client.try_flash_loan(&receiver, &2_000_000i128).is_err());
}

#[test]
fn test_flash_loan_zero_amount_fails() {
    let (env, client, _admin) = setup();
    let receiver = Address::generate(&env);
    assert!(client.try_flash_loan(&receiver, &0i128).is_err());
}

#[test]
fn test_multiple_loans_accumulate_stats() {
    let (env, client, _admin) = setup();
    let receiver = Address::generate(&env);
    client.flash_loan(&receiver, &100_000i128).unwrap();
    client.flash_loan(&receiver, &200_000i128).unwrap();
    let stats = client.get_stats();
    assert_eq!(stats.total_loans, 2);
    // fees: 500 + 1000 = 1500
    assert_eq!(stats.total_fees_collected, 1_500);
}
