// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Comprehensive test suite for the Pause Toggle contract.
//!
//! Covers: initialization, pause, unpause, get_pause_reason,
//! get_pause_timestamp, do_action guards, error codes, and full
//! lifecycle cycles.

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{Error, PauseToggle, PauseToggleClient};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Deploy and initialize in one step; returns (env, admin, client).
fn setup() -> (Env, Address, PauseToggleClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin);
    let env = std::boxed::Box::leak(std::boxed::Box::new(env));
    let client = PauseToggleClient::new(env, &id);
    (env.clone(), admin, client)
}

/// Advance ledger timestamp by `delta` seconds.
fn advance_time(env: &Env, delta: u64) {
    env.ledger().with_mut(|l| l.timestamp += delta);
}

fn make_str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

// ── init ──────────────────────────────────────────────────────────────────────

#[test]
fn init_sets_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn init_starts_unpaused() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin);
    assert!(!client.paused());
}

#[test]
fn init_pause_reason_is_none_after_init() {
    let (_, _, client) = setup();
    assert!(client.get_pause_reason().is_none());
}

#[test]
fn init_pause_timestamp_is_none_after_init() {
    let (_, _, client) = setup();
    assert!(client.get_pause_timestamp().is_none());
}

#[test]
#[should_panic(expected = "already initialized")]
fn init_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.init(&admin);
    client.init(&admin);
}

#[test]
#[should_panic(expected = "already initialized")]
fn init_twice_different_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    client.init(&admin1);
    client.init(&admin2);
}

// ── pause ─────────────────────────────────────────────────────────────────────

#[test]
fn pause_sets_paused_flag() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    assert!(client.paused());
}

#[test]
fn pause_without_reason_stores_none() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    assert!(client.get_pause_reason().is_none());
}

#[test]
fn pause_with_reason_stores_reason() {
    let (env, admin, client) = setup();
    let reason = make_str(&env, "security vulnerability discovered");
    client.pause(&admin, &Some(reason.clone()));
    assert_eq!(client.get_pause_reason(), Some(reason));
}

#[test]
fn pause_stores_timestamp() {
    let (env, admin, client) = setup();
    advance_time(&env, 500);
    let before = env.ledger().timestamp();
    client.pause(&admin, &None);
    let ts = client.get_pause_timestamp().unwrap();
    assert_eq!(ts, before);
}

#[test]
fn pause_timestamp_reflects_ledger_time() {
    let (env, admin, client) = setup();
    advance_time(&env, 1_000);
    client.pause(&admin, &None);
    assert_eq!(client.get_pause_timestamp().unwrap(), env.ledger().timestamp());
}

#[test]
fn pause_by_non_admin_returns_unauthorized() {
    let (env, _, client) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_pause(&stranger, &None);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn pause_already_paused_returns_already_in_state() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    let result = client.try_pause(&admin, &None);
    assert_eq!(result, Err(Ok(Error::AlreadyInState)));
}

#[test]
fn pause_on_uninitialized_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let caller = Address::generate(&env);
    let result = client.try_pause(&caller, &None);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

#[test]
fn pause_with_empty_reason_stores_empty_string() {
    let (env, admin, client) = setup();
    let empty = make_str(&env, "");
    client.pause(&admin, &Some(empty.clone()));
    assert_eq!(client.get_pause_reason(), Some(empty));
}

#[test]
fn pause_with_long_reason_stores_full_string() {
    let (env, admin, client) = setup();
    let long_reason = make_str(&env, "critical exploit found in transfer logic causing double-spend under edge conditions");
    client.pause(&admin, &Some(long_reason.clone()));
    assert_eq!(client.get_pause_reason(), Some(long_reason));
}

// ── unpause ───────────────────────────────────────────────────────────────────

#[test]
fn unpause_clears_paused_flag() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    assert!(!client.paused());
}

#[test]
fn unpause_clears_pause_reason() {
    let (env, admin, client) = setup();
    client.pause(&admin, &Some(make_str(&env, "reason")));
    client.unpause(&admin);
    assert!(client.get_pause_reason().is_none());
}

#[test]
fn unpause_clears_pause_timestamp() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    assert!(client.get_pause_timestamp().is_none());
}

#[test]
fn unpause_by_non_admin_returns_unauthorized() {
    let (env, admin, client) = setup();
    client.pause(&admin, &None);
    let stranger = Address::generate(&env);
    let result = client.try_unpause(&stranger);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn unpause_already_unpaused_returns_already_in_state() {
    let (_, admin, client) = setup();
    let result = client.try_unpause(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInState)));
}

#[test]
fn unpause_on_uninitialized_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let caller = Address::generate(&env);
    let result = client.try_unpause(&caller);
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

#[test]
fn unpause_state_is_idempotent_when_called_twice() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    // second unpause should error
    let result = client.try_unpause(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInState)));
}

// ── get_pause_reason ──────────────────────────────────────────────────────────

#[test]
fn get_pause_reason_none_when_not_paused() {
    let (_, _, client) = setup();
    assert!(client.get_pause_reason().is_none());
}

#[test]
fn get_pause_reason_returns_reason_when_paused_with_reason() {
    let (env, admin, client) = setup();
    let r = make_str(&env, "emergency");
    client.pause(&admin, &Some(r.clone()));
    assert_eq!(client.get_pause_reason(), Some(r));
}

#[test]
fn get_pause_reason_none_when_paused_without_reason() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    assert!(client.get_pause_reason().is_none());
}

#[test]
fn get_pause_reason_clears_after_unpause() {
    let (env, admin, client) = setup();
    client.pause(&admin, &Some(make_str(&env, "test")));
    client.unpause(&admin);
    assert!(client.get_pause_reason().is_none());
}

#[test]
fn get_pause_reason_updated_on_re_pause() {
    let (env, admin, client) = setup();
    client.pause(&admin, &Some(make_str(&env, "first pause")));
    client.unpause(&admin);
    client.pause(&admin, &Some(make_str(&env, "second pause")));
    assert_eq!(
        client.get_pause_reason(),
        Some(make_str(&env, "second pause"))
    );
}

#[test]
fn get_pause_reason_none_after_re_pause_without_reason() {
    let (env, admin, client) = setup();
    client.pause(&admin, &Some(make_str(&env, "first")));
    client.unpause(&admin);
    client.pause(&admin, &None);
    assert!(client.get_pause_reason().is_none());
}

// ── get_pause_timestamp ───────────────────────────────────────────────────────

#[test]
fn get_pause_timestamp_none_before_pause() {
    let (_, _, client) = setup();
    assert!(client.get_pause_timestamp().is_none());
}

#[test]
fn get_pause_timestamp_set_on_pause() {
    let (env, admin, client) = setup();
    advance_time(&env, 100);
    client.pause(&admin, &None);
    assert!(client.get_pause_timestamp().is_some());
}

#[test]
fn get_pause_timestamp_matches_ledger_at_pause_time() {
    let (env, admin, client) = setup();
    advance_time(&env, 999);
    let expected = env.ledger().timestamp();
    client.pause(&admin, &None);
    assert_eq!(client.get_pause_timestamp(), Some(expected));
}

#[test]
fn get_pause_timestamp_none_after_unpause() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    assert!(client.get_pause_timestamp().is_none());
}

#[test]
fn get_pause_timestamp_updates_on_re_pause() {
    let (env, admin, client) = setup();
    advance_time(&env, 100);
    client.pause(&admin, &None);
    let first_ts = client.get_pause_timestamp().unwrap();
    client.unpause(&admin);
    advance_time(&env, 500);
    client.pause(&admin, &None);
    let second_ts = client.get_pause_timestamp().unwrap();
    assert!(second_ts > first_ts);
}

#[test]
fn get_pause_timestamp_zero_at_genesis() {
    let (env, admin, client) = setup();
    // ledger timestamp starts at 0 by default
    let expected = env.ledger().timestamp();
    client.pause(&admin, &None);
    assert_eq!(client.get_pause_timestamp(), Some(expected));
}

// ── get_admin ─────────────────────────────────────────────────────────────────

#[test]
fn get_admin_returns_set_admin() {
    let (_, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn get_admin_on_uninitialized_returns_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    let result = client.try_get_admin();
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}

#[test]
fn get_admin_remains_same_after_pause_unpause() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    assert_eq!(client.get_admin(), admin);
}

// ── do_action ─────────────────────────────────────────────────────────────────

#[test]
fn do_action_succeeds_when_unpaused() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.do_action(&user);
}

#[test]
fn do_action_blocked_when_paused() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    client.pause(&admin, &None);
    let result = client.try_do_action(&user);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn do_action_succeeds_after_unpause() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    client.pause(&admin, &None);
    client.unpause(&admin);
    client.do_action(&user);
}

#[test]
fn do_action_blocked_immediately_after_pause() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    client.do_action(&user); // succeeds before pause
    client.pause(&admin, &None);
    let result = client.try_do_action(&user);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn do_action_different_users_all_blocked_when_paused() {
    let (env, admin, client) = setup();
    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    client.pause(&admin, &None);
    assert_eq!(
        client.try_do_action(&u1),
        Err(Ok(Error::ContractPaused))
    );
    assert_eq!(
        client.try_do_action(&u2),
        Err(Ok(Error::ContractPaused))
    );
}

// ── Full lifecycle cycles ─────────────────────────────────────────────────────

#[test]
fn full_pause_unpause_cycle() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    assert!(!client.paused());
    client.do_action(&user);

    client.pause(&admin, &None);
    assert!(client.paused());
    assert!(client.try_do_action(&user).is_err());

    client.unpause(&admin);
    assert!(!client.paused());
    client.do_action(&user);
}

#[test]
fn multiple_pause_unpause_cycles_work_correctly() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    for _ in 0..3 {
        client.pause(&admin, &None);
        assert!(client.paused());
        assert!(client.try_do_action(&user).is_err());
        client.unpause(&admin);
        assert!(!client.paused());
        client.do_action(&user);
    }
}

#[test]
fn reason_and_timestamp_cleared_and_reset_across_cycles() {
    let (env, admin, client) = setup();

    advance_time(&env, 100);
    client.pause(&admin, &Some(make_str(&env, "cycle1")));
    assert_eq!(client.get_pause_reason(), Some(make_str(&env, "cycle1")));
    let ts1 = client.get_pause_timestamp().unwrap();

    client.unpause(&admin);
    assert!(client.get_pause_reason().is_none());
    assert!(client.get_pause_timestamp().is_none());

    advance_time(&env, 200);
    client.pause(&admin, &Some(make_str(&env, "cycle2")));
    assert_eq!(client.get_pause_reason(), Some(make_str(&env, "cycle2")));
    let ts2 = client.get_pause_timestamp().unwrap();
    assert!(ts2 > ts1);
}

#[test]
fn paused_flag_false_at_rest_state() {
    let (_, _, client) = setup();
    assert!(!client.paused());
}

#[test]
fn admin_can_pause_and_unpause_repeatedly_without_error() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    client.pause(&admin, &None);
    client.unpause(&admin);
    assert!(!client.paused());
}

#[test]
fn state_is_consistent_after_many_operations() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);

    for i in 0..5u64 {
        advance_time(&env, 100);
        client.pause(&admin, &None);
        assert!(client.paused());
        assert_eq!(client.get_pause_timestamp().unwrap(), env.ledger().timestamp());
        assert!(client.try_do_action(&user).is_err());
        client.unpause(&admin);
        assert!(!client.paused());
        assert!(client.get_pause_timestamp().is_none());
        client.do_action(&user);
        let _ = i; // suppress unused warning
    }
}

// ── Property: only admin can change state ─────────────────────────────────────

#[test]
fn non_admin_cannot_pause_even_with_auth() {
    let (env, _, client) = setup();
    let attacker = Address::generate(&env);
    let result = client.try_pause(&attacker, &None);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert!(!client.paused());
}

#[test]
fn non_admin_cannot_unpause_even_with_auth() {
    let (env, admin, client) = setup();
    client.pause(&admin, &None);
    let attacker = Address::generate(&env);
    let result = client.try_unpause(&attacker);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
    assert!(client.paused()); // still paused
}

#[test]
fn pause_blocked_action_leaves_state_unchanged() {
    let (env, _, client) = setup();
    let attacker = Address::generate(&env);
    let _ = client.try_pause(&attacker, &None);
    assert!(!client.paused());
    assert!(client.get_pause_reason().is_none());
    assert!(client.get_pause_timestamp().is_none());
}

// ── Additional coverage ───────────────────────────────────────────────────────

#[test]
fn paused_query_is_false_initially() {
    let (_, _, client) = setup();
    assert_eq!(client.paused(), false);
}

#[test]
fn paused_query_is_true_after_pause() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    assert_eq!(client.paused(), true);
}

#[test]
fn paused_query_is_false_after_unpause() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    assert_eq!(client.paused(), false);
}

#[test]
fn pause_reason_special_characters_stored_correctly() {
    let (env, admin, client) = setup();
    let r = make_str(&env, "exploit: reentrancy in fn transfer()");
    client.pause(&admin, &Some(r.clone()));
    assert_eq!(client.get_pause_reason(), Some(r));
}

#[test]
fn pause_does_not_change_admin() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn unpause_does_not_change_admin() {
    let (_, admin, client) = setup();
    client.pause(&admin, &None);
    client.unpause(&admin);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn non_admin_pause_does_not_mutate_paused_state() {
    let (env, _, client) = setup();
    let attacker = Address::generate(&env);
    let _ = client.try_pause(&attacker, &None);
    // state must be unchanged
    assert!(!client.paused());
    assert!(client.get_pause_reason().is_none());
    assert!(client.get_pause_timestamp().is_none());
}

#[test]
fn non_admin_unpause_does_not_mutate_paused_state() {
    let (env, admin, client) = setup();
    client.pause(&admin, &Some(make_str(&env, "test")));
    let attacker = Address::generate(&env);
    let _ = client.try_unpause(&attacker);
    // state must be unchanged
    assert!(client.paused());
    assert_eq!(
        client.get_pause_reason(),
        Some(make_str(&env, "test"))
    );
}

#[test]
fn get_pause_reason_on_uninitialized_returns_none() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    // No init called — get_pause_reason should still return None (no panic)
    assert!(client.get_pause_reason().is_none());
}

#[test]
fn get_pause_timestamp_on_uninitialized_returns_none() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(PauseToggle, ());
    let client = PauseToggleClient::new(&env, &id);
    assert!(client.get_pause_timestamp().is_none());
}
