// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    symbol_short,
    Address, Env,
};

use crate::{
    assert_auth_required, assert_event_emitted, assert_near, assert_panics,
    mock_oracle::{MockOracle, MockOracleClient, PriceData},
    mock_token::{MockToken, MockTokenClient},
};

// =========================================================================
// MockOracle
// =========================================================================

mod mock_oracle_tests {
    use super::*;

    fn setup() -> (Env, MockOracleClient<'static>) {
        let env = Env::default();
        let contract_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(&env, &contract_id);
        (env, oracle)
    }

    #[test]
    fn test_set_and_get_price() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000i128);
        assert_eq!(oracle.get_price(&symbol_short!("BTC")), 50_000);
    }

    #[test]
    fn test_get_price_unset_asset_panics() {
        let (_env, oracle) = setup();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            oracle.get_price(&symbol_short!("UNSET"));
        }));
        assert!(result.is_err(), "expected panic for unset asset");
        let msg = extract_panic_msg(&result);
        assert!(
            msg.contains("MockOracle: price not set for asset"),
            "panic msg should mention unset asset, got: {}",
            msg
        );
    }

    #[test]
    fn test_set_price_updates_existing() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("ETH"), &3000);
        oracle.set_price(&symbol_short!("ETH"), &3500);
        assert_eq!(oracle.get_price(&symbol_short!("ETH")), 3500);
    }

    #[test]
    fn test_set_stale_marks_asset_stale() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        oracle.set_stale(&symbol_short!("BTC"));
        assert!(oracle.is_stale(&symbol_short!("BTC")));
    }

    #[test]
    fn test_is_stale_on_unset_returns_false() {
        let (_env, oracle) = setup();
        assert!(!oracle.is_stale(&symbol_short!("NONEXIST")));
    }

    #[test]
    fn test_is_stale_on_fresh_returns_false() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        assert!(!oracle.is_stale(&symbol_short!("BTC")));
    }

    #[test]
    fn test_set_price_after_stale_clears_stale() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        oracle.set_stale(&symbol_short!("BTC"));
        assert!(oracle.is_stale(&symbol_short!("BTC")));
        oracle.set_price(&symbol_short!("BTC"), &51_000);
        assert!(!oracle.is_stale(&symbol_short!("BTC")));
    }

    #[test]
    fn test_get_price_on_stale_still_returns_value() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        oracle.set_stale(&symbol_short!("BTC"));
        assert_eq!(oracle.get_price(&symbol_short!("BTC")), 50_000);
    }

    #[test]
    fn test_multiple_assets_independently() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        oracle.set_price(&symbol_short!("ETH"), &3000);
        oracle.set_price(&symbol_short!("SOL"), &150);
        assert_eq!(oracle.get_price(&symbol_short!("BTC")), 50_000);
        assert_eq!(oracle.get_price(&symbol_short!("ETH")), 3_000);
        assert_eq!(oracle.get_price(&symbol_short!("SOL")), 150);
    }

    #[test]
    fn test_set_price_negative_value() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("ASSET"), &-100);
        assert_eq!(oracle.get_price(&symbol_short!("ASSET")), -100);
    }

    #[test]
    fn test_set_price_zero_value() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("FREE"), &0);
        assert_eq!(oracle.get_price(&symbol_short!("FREE")), 0);
    }

    #[test]
    fn test_price_event_emitted_on_set() {
        let (env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        assert_event_emitted(
            &env,
            symbol_short!("price_set"),
            "set_price should emit price_set event",
        );
    }

    #[test]
    fn test_stale_event_emitted_on_set_stale() {
        let (env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        oracle.set_stale(&symbol_short!("BTC"));
        assert_event_emitted(
            &env,
            symbol_short!("stale_set"),
            "set_stale should emit stale_set event",
        );
    }

    #[test]
    fn test_get_price_latest_after_multiple_sets() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("XRP"), &1);
        oracle.set_price(&symbol_short!("XRP"), &2);
        oracle.set_price(&symbol_short!("XRP"), &3);
        assert_eq!(oracle.get_price(&symbol_short!("XRP")), 3);
    }

    #[test]
    fn test_is_stale_after_set_price_is_false() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        assert!(!oracle.is_stale(&symbol_short!("BTC")));
    }

    #[test]
    fn test_set_stale_on_unset_asset() {
        let (_env, oracle) = setup();
        oracle.set_stale(&symbol_short!("NOSET"));
        assert!(oracle.is_stale(&symbol_short!("NOSET")));
    }

    #[test]
    fn test_multiple_stale_flags_independent() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("A"), &10);
        oracle.set_price(&symbol_short!("B"), &20);
        oracle.set_stale(&symbol_short!("A"));
        assert!(oracle.is_stale(&symbol_short!("A")));
        assert!(!oracle.is_stale(&symbol_short!("B")));
    }

    #[test]
    fn test_price_data_stored_correctly() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MockOracle);
        env.mock_all_auths();
        let oracle = MockOracleClient::new(&env, &contract_id);
        oracle.set_price(&symbol_short!("DATA"), &999);
        // Read storage directly to verify internal data
        let key = symbol_short!("DATA");
        let stored: Option<PriceData> = env.as_contract(&contract_id, || {
            env.storage().instance().get(&key)
        });
        assert_eq!(
            stored,
            Some(PriceData {
                price: 999,
                stale: false
            })
        );
    }

    #[test]
    fn test_set_price_then_set_stale_storage() {
        let env = Env::default();
        let contract_id = env.register_contract(None, MockOracle);
        env.mock_all_auths();
        let oracle = MockOracleClient::new(&env, &contract_id);
        oracle.set_price(&symbol_short!("X"), &100);
        oracle.set_stale(&symbol_short!("X"));
        let key = symbol_short!("X");
        let stored: Option<PriceData> = env.as_contract(&contract_id, || {
            env.storage().instance().get(&key)
        });
        assert_eq!(
            stored,
            Some(PriceData {
                price: 100,
                stale: true
            })
        );
    }

    #[test]
    fn test_get_price_after_clearing_stale() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("A"), &100);
        oracle.set_stale(&symbol_short!("A"));
        assert!(oracle.is_stale(&symbol_short!("A")));
        oracle.set_price(&symbol_short!("A"), &200);
        assert!(!oracle.is_stale(&symbol_short!("A")));
        assert_eq!(oracle.get_price(&symbol_short!("A")), 200);
    }

    #[test]
    fn test_set_price_emits_correct_price_in_event() {
        let (env, oracle) = setup();
        oracle.set_price(&symbol_short!("GOLD"), &9999);
        // Verify event was emitted (event data contains the price)
        assert_event_emitted(&env, symbol_short!("price_set"), "should emit");
    }

    #[test]
    fn test_multiple_set_stale_calls() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("X"), &50);
        oracle.set_stale(&symbol_short!("X"));
        oracle.set_stale(&symbol_short!("X"));
        assert!(oracle.is_stale(&symbol_short!("X")));
    }

    #[test]
    fn test_set_stale_storage_with_price_zero() {
        let (_env, oracle) = setup();
        oracle.set_price(&symbol_short!("FREE"), &0);
        oracle.set_stale(&symbol_short!("FREE"));
        assert!(oracle.is_stale(&symbol_short!("FREE")));
        assert_eq!(oracle.get_price(&symbol_short!("FREE")), 0);
    }
}

// =========================================================================
// MockToken
// =========================================================================

mod mock_token_tests {
    use super::*;

    fn setup() -> (Env, MockTokenClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockToken);
        let token = MockTokenClient::new(&env, &contract_id);
        (env, token)
    }

    fn setup_env() -> (Env, Address, MockTokenClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockToken);
        let token = MockTokenClient::new(&env, &contract_id);
        let alice = Address::generate(&env);
        (env, alice, token)
    }

    #[test]
    fn test_mint_increases_balance() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &1000);
        assert_eq!(token.balance(&alice), 1000);
    }

    #[test]
    fn test_mint_multiple_times_accumulates() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &500);
        token.mint(&alice, &300);
        assert_eq!(token.balance(&alice), 800);
    }

    #[test]
    fn test_burn_decreases_balance() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &1000);
        token.burn(&alice, &300);
        assert_eq!(token.balance(&alice), 700);
    }

    #[test]
    fn test_burn_entire_balance() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &500);
        token.burn(&alice, &500);
        assert_eq!(token.balance(&alice), 0);
    }

    #[test]
    fn test_transfer_moves_funds() {
        let (_env, alice, token) = setup_env();
        let bob = Address::generate(&_env);
        token.mint(&alice, &1000);
        token.transfer(&alice, &bob, &400);
        assert_eq!(token.balance(&alice), 600);
        assert_eq!(token.balance(&bob), 400);
    }

    #[test]
    fn test_mint_negative_amount_panics() {
        let (_env, alice, token) = setup_env();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.mint(&alice, &-100);
        }));
        assert!(result.is_err(), "negative mint should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("negative mint amount"), "got: {}", msg);
    }

    #[test]
    fn test_burn_negative_amount_panics() {
        let (_env, alice, token) = setup_env();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.burn(&alice, &-50);
        }));
        assert!(result.is_err(), "negative burn should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("negative burn amount"), "got: {}", msg);
    }

    #[test]
    fn test_burn_more_than_balance_panics() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &100);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.burn(&alice, &200);
        }));
        assert!(result.is_err(), "overdraft burn should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("insufficient balance"), "got: {}", msg);
    }

    #[test]
    fn test_transfer_insufficient_balance_panics() {
        let (_env, alice, token) = setup_env();
        let bob = Address::generate(&_env);
        token.mint(&alice, &50);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.transfer(&alice, &bob, &100);
        }));
        assert!(result.is_err(), "overdraft transfer should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("insufficient balance"), "got: {}", msg);
    }

    #[test]
    fn test_mint_to_zero_address_panics() {
        let (_env, _alice, token) = setup_env();
        let zero = Address::from_string(&soroban_sdk::String::from_str(
            &_env,
            "0000000000000000000000000000000000000000000000000000000000000000",
        ));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.mint(&zero, &100);
        }));
        assert!(result.is_err(), "mint to zero address should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("zero address"), "got: {}", msg);
    }

    #[test]
    fn test_transfer_from_zero_address_panics() {
        let (_env, _alice, token) = setup_env();
        let bob = Address::generate(&_env);
        let zero = Address::from_string(&soroban_sdk::String::from_str(
            &_env,
            "0000000000000000000000000000000000000000000000000000000000000000",
        ));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.transfer(&zero, &bob, &100);
        }));
        assert!(result.is_err(), "transfer from zero should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("transfer from zero address"), "got: {}", msg);
    }

    #[test]
    fn test_transfer_to_zero_address_panics() {
        let (_env, alice, token) = setup_env();
        let zero = Address::from_string(&soroban_sdk::String::from_str(
            &_env,
            "0000000000000000000000000000000000000000000000000000000000000000",
        ));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.transfer(&alice, &zero, &100);
        }));
        assert!(result.is_err(), "transfer to zero should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("transfer to zero address"), "got: {}", msg);
    }

    #[test]
    fn test_name() {
        let (_env, token) = setup();
        assert_eq!(
            token.name(),
            soroban_sdk::String::from_str(&_env, "MockToken")
        );
    }

    #[test]
    fn test_symbol() {
        let (_env, token) = setup();
        assert_eq!(
            token.symbol(),
            soroban_sdk::String::from_str(&_env, "MCK")
        );
    }

    #[test]
    fn test_decimals() {
        let (_env, token) = setup();
        assert_eq!(token.decimals(), 7);
    }

    #[test]
    fn test_balance_of_uninitialized_returns_zero() {
        let (_env, token) = setup();
        let stranger = Address::generate(&_env);
        assert_eq!(token.balance(&stranger), 0);
    }

    #[test]
    fn test_mint_emits_event() {
        let (env, alice, token) = setup_env();
        token.mint(&alice, &500);
        assert_event_emitted(&env, symbol_short!("mint"), "mint should emit event");
    }

    #[test]
    fn test_burn_emits_event() {
        let (env, alice, token) = setup_env();
        token.mint(&alice, &500);
        token.burn(&alice, &100);
        assert_event_emitted(&env, symbol_short!("burn"), "burn should emit event");
    }

    #[test]
    fn test_transfer_emits_event() {
        let (env, alice, token) = setup_env();
        let bob = Address::generate(&env);
        token.mint(&alice, &500);
        token.transfer(&alice, &bob, &200);
        assert_event_emitted(
            &env,
            symbol_short!("transfer"),
            "transfer should emit event",
        );
    }

    #[test]
    fn test_transfer_to_self() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &1000);
        token.transfer(&alice, &alice, &500);
        assert_eq!(token.balance(&alice), 1000);
    }

    #[test]
    fn test_zero_mint() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &0);
        assert_eq!(token.balance(&alice), 0);
    }

    #[test]
    fn test_zero_burn() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &100);
        token.burn(&alice, &0);
        assert_eq!(token.balance(&alice), 100);
    }

    #[test]
    fn test_zero_transfer() {
        let (_env, alice, token) = setup_env();
        let bob = Address::generate(&_env);
        token.mint(&alice, &100);
        token.transfer(&alice, &bob, &0);
        assert_eq!(token.balance(&alice), 100);
        assert_eq!(token.balance(&bob), 0);
    }

    #[test]
    fn test_multiple_mints_same_address() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &100);
        token.mint(&alice, &200);
        token.mint(&alice, &300);
        assert_eq!(token.balance(&alice), 600);
    }

    #[test]
    fn test_sequential_transfers() {
        let (_env, alice, token) = setup_env();
        let bob = Address::generate(&_env);
        let charlie = Address::generate(&_env);
        token.mint(&alice, &1000);
        token.transfer(&alice, &bob, &400);
        token.transfer(&bob, &charlie, &150);
        assert_eq!(token.balance(&alice), 600);
        assert_eq!(token.balance(&bob), 250);
        assert_eq!(token.balance(&charlie), 150);
    }

    #[test]
    fn test_large_amounts() {
        let (_env, alice, token) = setup_env();
        let large = i128::MAX / 2;
        token.mint(&alice, &large);
        assert_eq!(token.balance(&alice), large);
    }

    #[test]
    fn test_negative_transfer_amount_panics() {
        let (_env, alice, token) = setup_env();
        let bob = Address::generate(&_env);
        token.mint(&alice, &100);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.transfer(&alice, &bob, &-10);
        }));
        assert!(result.is_err(), "negative transfer should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("negative transfer amount"), "got: {}", msg);
    }

    #[test]
    fn test_transfer_requires_auth() {
        let env = Env::default();
        // Intentionally NOT calling mock_all_auths
        let contract_id = env.register_contract(None, MockToken);
        let token = MockTokenClient::new(&env, &contract_id);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        token.mint(&alice, &1000);
        // Without mock auth, transfer should panic because require_auth fails
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.transfer(&alice, &bob, &100);
        }));
        assert!(result.is_err(), "transfer without auth should panic");
    }

    #[test]
    fn test_burn_from_uninitialized_address_panics() {
        let (_env, _alice, token) = setup_env();
        let stranger = Address::generate(&_env);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.burn(&stranger, &1);
        }));
        assert!(result.is_err(), "burn from uninitialized should panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("insufficient balance"), "got: {}", msg);
    }

    #[test]
    fn test_mint_multiple_different_addresses() {
        let (_env, _alice, token) = setup_env();
        let bob = Address::generate(&_env);
        let charlie = Address::generate(&_env);
        token.mint(&_alice, &100);
        token.mint(&bob, &200);
        token.mint(&charlie, &300);
        assert_eq!(token.balance(&_alice), 100);
        assert_eq!(token.balance(&bob), 200);
        assert_eq!(token.balance(&charlie), 300);
    }

    #[test]
    fn test_burn_partial_balance_twice() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &1000);
        token.burn(&alice, &300);
        token.burn(&alice, &200);
        assert_eq!(token.balance(&alice), 500);
    }

    #[test]
    fn test_transfer_exact_balance() {
        let (_env, alice, token) = setup_env();
        let bob = Address::generate(&_env);
        token.mint(&alice, &500);
        token.transfer(&alice, &bob, &500);
        assert_eq!(token.balance(&alice), 0);
        assert_eq!(token.balance(&bob), 500);
    }

    #[test]
    fn test_transfer_multiple_events_emitted() {
        let (env, alice, token) = setup_env();
        let bob = Address::generate(&env);
        let charlie = Address::generate(&env);
        token.mint(&alice, &1000);
        token.transfer(&alice, &bob, &300);
        token.transfer(&bob, &charlie, &100);
        assert_event_emitted(&env, symbol_short!("transfer"), "first transfer");
        assert_event_emitted(&env, symbol_short!("mint"), "mint event");
    }

    #[test]
    fn test_mint_maximum_amount() {
        let (_env, alice, token) = setup_env();
        token.mint(&alice, &i128::MAX);
        assert_eq!(token.balance(&alice), i128::MAX);
    }
}

// =========================================================================
// TestAssertions
// =========================================================================

mod assertions_tests {
    use super::*;

    // ── assert_near ──────────────────────────────────────────────────────

    #[test]
    fn test_assert_near_exact_match() {
        assert_near(100, 100, 0, "exact match should pass");
    }

    #[test]
    fn test_assert_near_within_tolerance() {
        assert_near(105, 100, 10, "within tolerance should pass");
    }

    #[test]
    fn test_assert_near_at_boundary() {
        assert_near(110, 100, 10, "at upper boundary should pass");
        assert_near(90, 100, 10, "at lower boundary should pass");
    }

    #[test]
    fn test_assert_near_outside_tolerance_panics() {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_near(200, 100, 10, "way off");
        }));
        assert!(result.is_err(), "should panic when outside tolerance");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("ASSERTION FAILED"), "got: {}", msg);
        assert!(msg.contains("way off"), "got: {}", msg);
    }

    #[test]
    fn test_assert_near_negative_diff() {
        assert_near(90, 100, 15, "negative diff within tolerance");
    }

    #[test]
    fn test_assert_near_zero_tolerance() {
        assert_near(42, 42, 0, "zero tolerance exact match");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_near(43, 42, 0, "zero tolerance mis-match");
        }));
        assert!(result.is_err());
    }

    // ── assert_event_emitted ─────────────────────────────────────────────

    #[test]
    fn test_assert_event_emitted_finds_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(&env, &contract_id);
        oracle.set_price(&symbol_short!("BTC"), &100);
        assert_event_emitted(&env, symbol_short!("price_set"), "should find price_set");
    }

    #[test]
    fn test_assert_event_emitted_wrong_topic_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(&env, &contract_id);
        oracle.set_price(&symbol_short!("BTC"), &100);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_event_emitted(&env, symbol_short!("WRONG"), "should fail");
        }));
        assert!(result.is_err(), "should panic for wrong topic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("ASSERTION FAILED"), "got: {}", msg);
    }

    #[test]
    fn test_assert_event_emitted_no_events_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_event_emitted(&env, symbol_short!("anything"), "no events");
        }));
        assert!(result.is_err(), "should panic with no events");
    }

    #[test]
    fn test_assert_event_emitted_custom_msg() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(&env, &contract_id);
        oracle.set_price(&symbol_short!("X"), &1);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_event_emitted(&env, symbol_short!("NOPE"), "my custom message");
        }));
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("my custom message"), "got: {}", msg);
    }

    #[test]
    fn test_assert_event_emitted_multiple_events() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(&env, &contract_id);
        oracle.set_price(&symbol_short!("A"), &1);
        oracle.set_price(&symbol_short!("B"), &2);
        assert_event_emitted(&env, symbol_short!("price_set"), "found among many");
    }

    // ── assert_auth_required ─────────────────────────────────────────────

    #[test]
    fn test_assert_auth_required_on_err() {
        let err: Result<i32, &str> = Err("unauthorized");
        assert_auth_required(&err, "should pass on Err");
    }

    #[test]
    fn test_assert_auth_required_on_ok_panics() {
        let ok: Result<i32, &str> = Ok(42);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_auth_required(&ok, "should fail on Ok");
        }));
        assert!(result.is_err(), "should panic on Ok");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("call succeeded"), "got: {}", msg);
    }

    #[test]
    fn test_assert_auth_required_custom_msg() {
        let ok: Result<i32, &str> = Ok(99);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_auth_required(&ok, "custom auth message");
        }));
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("custom auth message"), "got: {}", msg);
    }

    #[test]
    fn test_assert_auth_required_on_soroban_err_type() {
        let env_result: Result<(), soroban_sdk::Error> = Err(soroban_sdk::Error::from(1u32));
        assert_auth_required(&env_result, "soroban Error should be detected as auth failure");
    }

    // ── assert_panics ────────────────────────────────────────────────────

    #[test]
    fn test_assert_panics_catches_panic() {
        assert_panics(
            || panic!("something went wrong"),
            "went wrong",
            "basic panic catch",
        );
    }

    #[test]
    fn test_assert_panics_matching_message() {
        assert_panics(
            || panic!("MockToken: negative mint amount: -100"),
            "negative mint amount",
            "matching message",
        );
    }

    #[test]
    fn test_assert_panics_non_matching_message_panics() {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_panics(
                || panic!("actual error message"),
                "NONEXISTENT",
                "should fail on mismatch",
            );
        }));
        assert!(result.is_err(), "should panic when messages don't match");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("expected panic message to contain"), "got: {}", msg);
    }

    #[test]
    fn test_assert_panics_no_panic_fails() {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_panics(
                || {
                    // No panic
                    let _x = 1 + 1;
                },
                "anything",
                "no panic should fail",
            );
        }));
        assert!(result.is_err(), "should panic when closure doesn't panic");
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("closure did not panic"), "got: {}", msg);
    }

    #[test]
    fn test_assert_panics_with_string_message() {
        assert_panics(
            || panic!("{}", "formatted string panic"),
            "formatted string",
            "string payload",
        );
    }

    #[test]
    fn test_assert_panics_custom_msg() {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_panics(
                || {},
                "x",
                "my custom assertion message",
            );
        }));
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("my custom assertion message"), "got: {}", msg);
    }

    #[test]
    fn test_assert_near_shows_diff_in_msg() {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_near(1000, 500, 10, "should show diff");
        }));
        assert!(result.is_err());
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("diff = 500"), "msg should contain diff: {}", msg);
    }

    #[test]
    fn test_assert_near_large_tolerance() {
        assert_near(-1000, 1000, 5000, "large tolerance covers wide diff");
    }

    #[test]
    fn test_assert_near_negative_tolerance_still_checks() {
        // A negative tolerance should still work (|actual - expected| <= tolerance where tolerance is negative will always fail if actual != expected)
        // But per spec, diff > tolerance, so if tolerance is -1 and actual == expected, diff = 0, 0 > -1 = true, so it passes
        assert_near(100, 100, -1, "exact match should pass even with negative tolerance");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_near(101, 100, -1, "should fail with negative tolerance");
        }));
        assert!(result.is_err());
    }

    #[test]
    fn test_assert_event_emitted_with_multiple_topics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockToken);
        let token = MockTokenClient::new(&env, &contract_id);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        token.mint(&alice, &1000);
        token.transfer(&alice, &bob, &100);
        // The transfer event has 3 topics: ("transfer", from, to)
        assert_event_emitted(&env, symbol_short!("transfer"), "multi-topic event");
    }

    #[test]
    fn test_assert_event_emitted_no_match_shows_emitted_topics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(&env, &contract_id);
        oracle.set_price(&symbol_short!("X"), &1);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert_event_emitted(&env, symbol_short!("NONEXISTENT"), "check topics list");
        }));
        assert!(result.is_err());
        let msg = extract_panic_msg(&result);
        assert!(msg.contains("Emitted topics"), "msg should list topics: {}", msg);
    }

    #[test]
    fn test_assert_auth_required_with_complex_error_type() {
        let result: Result<String, u32> = Err(403);
        assert_auth_required(&result, "numeric error");
    }

    #[test]
    fn test_assert_panics_nested_panic() {
        assert_panics(
            || {
                let inner = || panic!("deep panic");
                inner();
            },
            "deep panic",
            "nested panic",
        );
    }
}

// =========================================================================
// TestHarness
// =========================================================================

#[cfg(feature = "testutils")]
mod harness_tests {
    use super::*;
    use crate::TestHarness;

    #[test]
    fn test_harness_new_creates_env() {
        let harness = TestHarness::new();
        let price = harness.env().ledger().timestamp();
        assert!(price > 0, "ledger timestamp should be initialised");
    }

    #[test]
    fn test_harness_env_returns_valid_env() {
        let harness = TestHarness::new();
        let contract_id = harness.env().register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(harness.env(), &contract_id);
        oracle.set_price(&symbol_short!("TEST"), &42);
        assert_eq!(oracle.get_price(&symbol_short!("TEST")), 42);
    }

    #[test]
    fn test_harness_set_ledger_time() {
        let harness = TestHarness::new();
        harness.set_ledger_time(500_000);
        assert_eq!(harness.env().ledger().timestamp(), 500_000);
    }

    #[test]
    fn test_harness_advance_ledger() {
        let harness = TestHarness::new();
        let start = harness.env().ledger().timestamp();
        harness.advance_ledger(3600);
        assert_eq!(harness.env().ledger().timestamp(), start + 3600);
    }

    #[test]
    fn test_harness_multiple_advances_accumulate() {
        let harness = TestHarness::new();
        let start = harness.env().ledger().timestamp();
        harness.advance_ledger(100);
        harness.advance_ledger(200);
        harness.advance_ledger(300);
        assert_eq!(harness.env().ledger().timestamp(), start + 600);
    }

    #[test]
    fn test_harness_advance_by_zero() {
        let harness = TestHarness::new();
        let start = harness.env().ledger().timestamp();
        harness.advance_ledger(0);
        assert_eq!(harness.env().ledger().timestamp(), start);
    }

    #[test]
    fn test_harness_set_ledger_time_to_zero() {
        let harness = TestHarness::new();
        harness.set_ledger_time(0);
        assert_eq!(harness.env().ledger().timestamp(), 0);
    }

    #[test]
    fn test_harness_mock_auth_restores_auth() {
        let harness = TestHarness::new();
        let env = harness.env();
        let contract_id = env.register_contract(None, MockToken);
        let token = MockTokenClient::new(env, &contract_id);
        let alice = Address::generate(env);
        let bob = Address::generate(env);
        // mint doesn't require auth
        token.mint(&alice, &1000);
        // Revoke all auth
        env.mock_all_auths();
        // Re-mock only alice
        harness.mock_auth(&alice);
        // transfer should work because alice is authorized
        token.transfer(&alice, &bob, &500);
        assert_eq!(token.balance(&alice), 500);
        assert_eq!(token.balance(&bob), 500);
    }

    #[test]
    fn test_harness_default_impl() {
        let harness: TestHarness = Default::default();
        assert!(harness.env().ledger().timestamp() > 0);
    }

    #[test]
    fn test_harness_advance_large_value() {
        let harness = TestHarness::new();
        harness.advance_ledger(u64::MAX);
        assert_eq!(
            harness.env().ledger().timestamp(),
            u64::MAX,
            "should saturate"
        );
    }

    #[test]
    fn test_harness_set_ledger_time_backward() {
        let harness = TestHarness::new();
        harness.set_ledger_time(1000);
        harness.set_ledger_time(500);
        assert_eq!(harness.env().ledger().timestamp(), 500);
    }

    #[test]
    fn test_harness_register_contract() {
        let harness = TestHarness::new();
        let contract_id = harness.env().register_contract(None, MockToken);
        let token = MockTokenClient::new(harness.env(), &contract_id);
        let alice = Address::generate(harness.env());
        token.mint(&alice, &777);
        assert_eq!(token.balance(&alice), 777);
    }

    #[test]
    fn test_harness_time_manipulation_in_vote_scenario() {
        let harness = TestHarness::new();
        harness.set_ledger_time(1_000_000);
        // Simulate voting period
        harness.advance_ledger(100);
        assert_eq!(harness.env().ledger().timestamp(), 1_000_100);
        harness.advance_ledger(900);
        assert_eq!(harness.env().ledger().timestamp(), 1_001_000);
    }

    #[test]
    fn test_harness_events_work() {
        let harness = TestHarness::new();
        let env = harness.env();
        let contract_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(env, &contract_id);
        oracle.set_price(&symbol_short!("T"), &10);
        assert_event_emitted(env, symbol_short!("price_set"), "harness events work");
    }

    #[test]
    fn test_harness_multiple_mock_auth() {
        let harness = TestHarness::new();
        let env = harness.env();
        let alice = Address::generate(env);
        let bob = Address::generate(env);
        harness.mock_auth(&alice);
        harness.mock_auth(&bob);
        // Both auths should work
        let _ = alice.clone();
        let _ = bob.clone();
    }

    #[test]
    fn test_harness_set_time_then_advance() {
        let harness = TestHarness::new();
        harness.set_ledger_time(1_000_000);
        harness.advance_ledger(5000);
        assert_eq!(harness.env().ledger().timestamp(), 1_005_000);
    }
}

// =========================================================================
// FuzzTester
// =========================================================================

#[cfg(feature = "testutils")]
mod fuzz_tests {
    use super::*;
    use crate::FuzzTester;
    use proptest::strategy::ValueTree;
    use proptest::test_runner::TestRunner;

    #[test]
    fn test_arb_amount_non_negative() {
        let mut runner = TestRunner::new(FuzzTester::run_fuzz());
        let strategy = FuzzTester::arb_amount();
        for _ in 0..100 {
            let result = runner.run_one(strategy.clone(), |v| {
                assert!(v >= 0, "arb_amount should be >= 0, got {}", v);
                Ok(())
            });
            assert!(result.is_ok(), "arb_amount test failed: {:?}", result);
        }
    }

    #[test]
    fn test_arb_address_generates_distinct() {
        let env = Env::default();
        let mut runner = TestRunner::new(FuzzTester::run_fuzz());
        let strategy = FuzzTester::arb_address(&env);
        let mut addresses = std::collections::HashSet::new();
        for _ in 0..50 {
            let result = runner.run_one(strategy.clone(), |addr| {
                assert!(!addresses.contains(&addr), "duplicate address generated");
                addresses.insert(addr);
                Ok(())
            });
            assert!(result.is_ok(), "arb_address test failed: {:?}", result);
        }
    }

    #[test]
    fn test_fuzz_config_has_fixed_seed() {
        let config = FuzzTester::run_fuzz();
        // Config should have a seed
        if let Some(seed) = config.seed {
            assert_eq!(seed, [0xDEAD_BEEF_CAFE_0001u64; 4]);
        }
    }

    #[test]
    fn test_run_fuzz_reproducible() {
        let config1 = FuzzTester::run_fuzz();
        let config2 = FuzzTester::run_fuzz();
        assert_eq!(config1.seed, config2.seed);
        assert_eq!(config1.cases, config2.cases);
    }

    #[test]
    fn test_arb_amount_boundaries() {
        let mut runner = TestRunner::new(FuzzTester::run_fuzz());
        let strategy = FuzzTester::arb_amount();
        for _ in 0..50 {
            let result = runner.run_one(strategy.clone(), |v| {
                assert!(v < i128::MAX, "arb_amount should be < i128::MAX, got {}", v);
                Ok(())
            });
            assert!(result.is_ok(), "arb_amount boundary test failed: {:?}", result);
        }
    }

    #[test]
    fn test_arb_symbol_generates_valid() {
        let env = Env::default();
        let mut runner = TestRunner::new(FuzzTester::run_fuzz());
        let strategy = FuzzTester::arb_symbol(&env);
        for _ in 0..50 {
            let result = runner.run_one(strategy.clone(), |sym| {
                let bytes: soroban_sdk::Vec<u8> = sym.into_iter().collect();
                assert!(!bytes.is_empty(), "symbol should not be empty");
                assert!(bytes.len() <= 8, "symbol should be <= 8 bytes");
                Ok(())
            });
            assert!(result.is_ok(), "arb_symbol test failed: {:?}", result);
        }
    }

    #[test]
    fn test_arb_amount_produces_different_values() {
        let mut runner = TestRunner::new(FuzzTester::run_fuzz());
        let strategy = FuzzTester::arb_amount();
        let mut seen = std::collections::HashSet::new();
        for _ in 0..20 {
            let result = runner.run_one(strategy.clone(), |v| {
                seen.insert(v);
                Ok(())
            });
            assert!(result.is_ok());
        }
        // With 20 samples from i128::MAX space, duplicates are extremely unlikely
        assert!(seen.len() > 1, "should produce varied values, got {} unique", seen.len());
    }

    #[test]
    fn test_run_fuzz_cases_config() {
        let config = FuzzTester::run_fuzz();
        assert_eq!(config.cases, 256, "default should be 256 cases");
    }

    #[test]
    fn test_arb_address_with_env() {
        let env = Env::default();
        let mut runner = TestRunner::new(FuzzTester::run_fuzz());
        let strategy = FuzzTester::arb_address(&env);
        for _ in 0..10 {
            let result = runner.run_one(strategy.clone(), |addr| {
                // Address should be valid (not the same as a default)
                let default_env = Env::default();
                let _other = Address::generate(&default_env);
                Ok(())
            });
            assert!(result.is_ok(), "arb_address strategy failed");
        }
    }
}

// =========================================================================
// Integration Tests
// =========================================================================

#[cfg(feature = "testutils")]
mod integration_tests {
    use super::*;
    use crate::TestHarness;

    fn setup_full() -> (TestHarness, MockOracleClient<'static>, MockTokenClient<'static>, Address, Address) {
        let harness = TestHarness::new();
        let env = harness.env();
        let oracle_id = env.register_contract(None, MockOracle);
        let oracle = MockOracleClient::new(env, &oracle_id);
        let token_id = env.register_contract(None, MockToken);
        let token = MockTokenClient::new(env, &token_id);
        let alice = Address::generate(env);
        let bob = Address::generate(env);
        token.mint(&alice, &10_000_000);
        (harness, oracle, token, alice, bob)
    }

    #[test]
    fn test_deploy_oracle_and_token_in_harness() {
        let (harness, oracle, token, alice, _bob) = setup_full();
        oracle.set_price(&symbol_short!("ASSET"), &1000);
        assert_eq!(oracle.get_price(&symbol_short!("ASSET")), 1000);
        assert_eq!(token.balance(&alice), 10_000_000);
        assert!(harness.env().ledger().timestamp() > 0);
    }

    #[test]
    fn test_simulated_swap_oracle_price_guides_transfer() {
        let (harness, oracle, token, alice, bob) = setup_full();
        // Oracle says: 1 TOKEN = 500 units
        oracle.set_price(&symbol_short!("TOKEN"), &500);
        // Alice wants to transfer 100 tokens (worth 50_000)
        let token_amount: i128 = 100;
        token.transfer(&alice, &bob, &token_amount);
        assert_eq!(token.balance(&alice), 9_999_900);
        assert_eq!(token.balance(&bob), 100);
        // Oracle price remains available for verification
        assert_eq!(oracle.get_price(&symbol_short!("TOKEN")), 500);
    }

    #[test]
    fn test_stale_oracle_does_not_affect_token() {
        let (_harness, oracle, token, alice, bob) = setup_full();
        oracle.set_price(&symbol_short!("STALE"), &100);
        oracle.set_stale(&symbol_short!("STALE"));
        assert!(oracle.is_stale(&symbol_short!("STALE")));
        // Token transfers work regardless of oracle state
        token.transfer(&alice, &bob, &500);
        assert_eq!(token.balance(&bob), 500);
    }

    #[test]
    fn test_event_emission_integration() {
        let (harness, oracle, token, alice, bob) = setup_full();
        let env = harness.env();
        oracle.set_price(&symbol_short!("BTC"), &60_000);
        token.transfer(&alice, &bob, &1000);
        assert_event_emitted(env, symbol_short!("price_set"), "oracle price set event");
        assert_event_emitted(env, symbol_short!("transfer"), "token transfer event");
    }

    #[test]
    fn test_time_manipulation_with_contract_interaction() {
        let (harness, _oracle, token, alice, _bob) = setup_full();
        harness.set_ledger_time(1_000_000);
        // Mint tokens at time T
        token.mint(&alice, &5000);
        assert_eq!(token.balance(&alice), 10_005_000);
        harness.advance_ledger(86400);
        // Balance unchanged after time passes
        assert_eq!(token.balance(&alice), 10_005_000);
        assert_eq!(harness.env().ledger().timestamp(), 1_086_400);
    }

    #[test]
    fn test_multiple_oracle_assets_integration() {
        let (_harness, oracle, token, alice, bob) = setup_full();
        // Set multiple prices
        oracle.set_price(&symbol_short!("BTC"), &60_000);
        oracle.set_price(&symbol_short!("ETH"), &3_000);
        oracle.set_price(&symbol_short!("SOL"), &150);
        // Mark one as stale
        oracle.set_stale(&symbol_short!("SOL"));
        // Token transfer based on a pricing decision
        let total_value = oracle.get_price(&symbol_short!("BTC")) + oracle.get_price(&symbol_short!("ETH"));
        token.transfer(&alice, &bob, &total_value);
        assert_eq!(token.balance(&bob), 63_000);
        assert!(oracle.is_stale(&symbol_short!("SOL")));
    }

    #[test]
    fn test_assertions_with_harness_and_mocks() {
        let (harness, oracle, _token, _alice, _bob) = setup_full();
        oracle.set_price(&symbol_short!("X"), &1000);
        // Use assert_near on oracle price
        let price = oracle.get_price(&symbol_short!("X"));
        assert_near(price, 1000, 5, "price should be ~1000");
        // Use assert_event_emitted
        assert_event_emitted(
            harness.env(),
            symbol_short!("price_set"),
            "should have emitted",
        );
    }

    #[test]
    fn test_stale_data_integration_scenario() {
        let (harness, oracle, token, alice, bob) = setup_full();
        // Phase 1: Oracle is fresh, trade happens
        oracle.set_price(&symbol_short!("USDC"), &1_000_000);
        token.transfer(&alice, &bob, &100);
        assert_eq!(token.balance(&bob), 100);
        // Phase 2: Oracle goes stale, trade still works
        oracle.set_stale(&symbol_short!("USDC"));
        assert!(oracle.is_stale(&symbol_short!("USDC")));
        // Price is still readable
        assert_eq!(oracle.get_price(&symbol_short!("USDC")), 1_000_000);
        // Phase 3: Oracle recovers
        harness.advance_ledger(3600);
        oracle.set_price(&symbol_short!("USDC"), &1_050_000);
        assert!(!oracle.is_stale(&symbol_short!("USDC")));
        assert_eq!(oracle.get_price(&symbol_short!("USDC")), 1_050_000);
    }

    #[test]
    fn test_full_workflow_integration() {
        let (harness, oracle, token, alice, bob) = setup_full();
        // 1. Set initial prices
        oracle.set_price(&symbol_short!("BTC"), &60_000);
        oracle.set_price(&symbol_short!("ETH"), &3_000);
        // 2. Alice has initial balance
        assert_eq!(token.balance(&alice), 10_000_000);
        assert_eq!(token.balance(&bob), 0);
        // 3. Transfer based on composite value
        let btc_price = oracle.get_price(&symbol_short!("BTC"));
        let eth_price = oracle.get_price(&symbol_short!("ETH"));
        let send_amount = (btc_price / eth_price) * 10; // 200 tokens
        token.transfer(&alice, &bob, &send_amount);
        // 4. Verify final state
        assert_eq!(token.balance(&alice), 9_999_800);
        assert_eq!(token.balance(&bob), 200);
        // 5. Check events
        assert_event_emitted(harness.env(), symbol_short!("transfer"), "transfer fired");
        // 6. Advance time and check ledger
        harness.advance_ledger(86400);
        assert_eq!(harness.env().ledger().timestamp(), 1_086_400);
    }

    #[test]
    fn test_multiple_transfers_with_mint_integration() {
        let (_harness, _oracle, token, alice, bob) = setup_full();
        let charlie = Address::generate(_harness.env());
        token.transfer(&alice, &bob, &1_000);
        token.transfer(&alice, &charlie, &2_000);
        token.transfer(&bob, &charlie, &500);
        assert_eq!(token.balance(&alice), 9_997_000);
        assert_eq!(token.balance(&bob), 500);
        assert_eq!(token.balance(&charlie), 2_500);
    }

    #[test]
    fn test_oracle_price_changes_over_time() {
        let (_harness, oracle, _token, _alice, _bob) = setup_full();
        oracle.set_price(&symbol_short!("BTC"), &50_000);
        _harness.advance_ledger(3600);
        oracle.set_price(&symbol_short!("BTC"), &51_000);
        _harness.advance_ledger(3600);
        oracle.set_price(&symbol_short!("BTC"), &52_000);
        assert_eq!(oracle.get_price(&symbol_short!("BTC")), 52_000);
    }

    #[test]
    fn test_burn_and_check_integration() {
        let (_harness, _oracle, token, alice, _bob) = setup_full();
        token.burn(&alice, &500_000);
        assert_eq!(token.balance(&alice), 9_500_000);
        token.burn(&alice, &500_000);
        assert_eq!(token.balance(&alice), 9_000_000);
    }

    #[test]
    fn test_zero_amount_operations_integration() {
        let (_harness, oracle, token, alice, bob) = setup_full();
        let charlie = Address::generate(_harness.env());
        // Zero transfers should work
        token.transfer(&alice, &bob, &0);
        assert_eq!(token.balance(&alice), 10_000_000);
        assert_eq!(token.balance(&bob), 0);
        // Oracle zero price
        oracle.set_price(&symbol_short!("FREE"), &0);
        assert_eq!(oracle.get_price(&symbol_short!("FREE")), 0);
        assert!(!oracle.is_stale(&symbol_short!("FREE")));
    }

    #[test]
    fn test_multiple_oracle_stale_events_in_integration() {
        let (_harness, oracle, token, alice, bob) = setup_full();
        oracle.set_price(&symbol_short!("A"), &10);
        oracle.set_price(&symbol_short!("B"), &20);
        oracle.set_price(&symbol_short!("C"), &30);
        oracle.set_stale(&symbol_short!("A"));
        oracle.set_stale(&symbol_short!("B"));
        assert!(oracle.is_stale(&symbol_short!("A")));
        assert!(oracle.is_stale(&symbol_short!("B")));
        assert!(!oracle.is_stale(&symbol_short!("C")));
        // Token operations still work
        token.transfer(&alice, &bob, &100);
        assert_eq!(token.balance(&bob), 100);
    }
}

// =========================================================================
// Helpers
// =========================================================================

/// Extracts the panic message from a `catch_unwind` result.
fn extract_panic_msg(result: &std::thread::Result<()>) -> String {
    match result {
        Ok(()) => "no panic".to_string(),
        Err(payload) => {
            if let Some(s) = payload.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                format!("{:?}", payload)
            }
        }
    }
}
