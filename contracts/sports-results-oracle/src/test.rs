// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{SportsResultsOracle, SportsResultsOracleClient};
use crate::types::{Error, SportDataStatus};

fn setup() -> (Env, SportsResultsOracleClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SportsResultsOracle);
    let client = SportsResultsOracleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, client, admin)
}

fn sport(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    let result = client.try_initialize(&admin, &None);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_with_threshold() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &Some(3));
    assert_eq!(client.get_threshold(), 3);
}

#[test]
fn test_initialize_zero_threshold_fails() {
    let (_, client, admin) = setup();
    let result = client.try_initialize(&admin, &Some(0));
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

// ── Data Sources ──────────────────────────────────────────────────────────────

#[test]
fn test_add_data_source() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    let ds = client.get_data_source(&source);
    assert!(ds.active);
    assert_eq!(ds.submissions, 0);
}

#[test]
fn test_add_duplicate_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    let result = client.try_add_data_source(&admin, &source, &sport(&env, "ESPN2"));
    assert_eq!(result, Err(Ok(Error::SourceAlreadyExists)));
}

#[test]
fn test_remove_data_source() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    client.remove_data_source(&admin, &source);
    let ds = client.get_data_source(&source);
    assert!(!ds.active);
}

#[test]
fn test_remove_nonexistent_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    let result = client.try_remove_data_source(&admin, &source);
    assert_eq!(result, Err(Ok(Error::SourceNotFound)));
}

#[test]
fn test_non_admin_cannot_add_source() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let attacker = Address::generate(&env);
    let source = Address::generate(&env);
    let result = client.try_add_data_source(&attacker, &source, &sport(&env, "Fake"));
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Submit Sports Data ────────────────────────────────────────────────────────

#[test]
fn test_submit_sports_data() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));

    let id = client.submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    assert_eq!(id, 0);
    assert_eq!(client.get_result_count(), 1);
}

#[test]
fn test_submit_increments_source_submissions() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    client.submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    let ds = client.get_data_source(&source);
    assert_eq!(ds.submissions, 1);
}

#[test]
fn test_submit_from_unknown_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let unknown = Address::generate(&env);
    let result = client.try_submit_sports_data(
        &unknown,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    assert_eq!(result, Err(Ok(Error::SourceNotFound)));
}

#[test]
fn test_submit_from_inactive_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    client.remove_data_source(&admin, &source);
    let result = client.try_submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    assert_eq!(result, Err(Ok(Error::SourceInactive)));
}

#[test]
fn test_submit_empty_event_id_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    let result = client.try_submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, ""),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    assert_eq!(result, Err(Ok(Error::InvalidEventId)));
}

// ── Confirmation & Verification ───────────────────────────────────────────────

#[test]
fn test_confirm_result_auto_verifies() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &Some(2));
    let source1 = Address::generate(&env);
    let source2 = Address::generate(&env);
    client.add_data_source(&admin, &source1, &sport(&env, "ESPN"));
    client.add_data_source(&admin, &source2, &sport(&env, "BBC"));

    let id = client.submit_sports_data(
        &source1,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );

    // After submit: 1 confirmation, threshold=2 → still Pending
    let result = client.get_sports_data(&id);
    assert_eq!(result.status, SportDataStatus::Pending);

    // Second confirmation → auto-verified
    client.confirm_result(&source2, &id);
    let result = client.get_sports_data(&id);
    assert_eq!(result.status, SportDataStatus::Verified);
}

#[test]
fn test_confirm_from_inactive_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &Some(2));
    let source1 = Address::generate(&env);
    let source2 = Address::generate(&env);
    client.add_data_source(&admin, &source1, &sport(&env, "ESPN"));
    client.add_data_source(&admin, &source2, &sport(&env, "BBC"));

    let id = client.submit_sports_data(
        &source1,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    client.remove_data_source(&admin, &source2);
    let result = client.try_confirm_result(&source2, &id);
    assert_eq!(result, Err(Ok(Error::SourceInactive)));
}

// ── Finalization ──────────────────────────────────────────────────────────────

#[test]
fn test_finalize_result() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    let id = client.submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    client.finalize_result(&admin, &id);
    let result = client.get_sports_data(&id);
    assert_eq!(result.status, SportDataStatus::Finalized);
}

#[test]
fn test_finalize_twice_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    let id = client.submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    client.finalize_result(&admin, &id);
    let result = client.try_finalize_result(&admin, &id);
    assert_eq!(result, Err(Ok(Error::ResultAlreadyFinalized)));
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

#[test]
fn test_circuit_breaker_blocks_submissions() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    client.set_circuit_breaker(&admin, &true);
    assert!(client.is_circuit_breaker_active());

    let result = client.try_submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    assert_eq!(result, Err(Ok(Error::CircuitBreakerActive)));
}

#[test]
fn test_circuit_breaker_can_be_deactivated() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    client.set_circuit_breaker(&admin, &true);
    client.set_circuit_breaker(&admin, &false);
    assert!(!client.is_circuit_breaker_active());
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_submissions() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    client.pause(&admin);
    assert!(client.is_paused());

    let result = client.try_submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_unpause_restores_submissions() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());
    let id = client.submit_sports_data(
        &source,
        &sport(&env, "Football"),
        &sport(&env, "EVT001"),
        &sport(&env, "TeamA"),
        &sport(&env, "TeamB"),
        &2u32,
        &1u32,
    );
    assert_eq!(id, 0);
}

// ── Threshold ─────────────────────────────────────────────────────────────────

#[test]
fn test_set_verification_threshold() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    client.set_verification_threshold(&admin, &5);
    assert_eq!(client.get_threshold(), 5);
}

#[test]
fn test_set_zero_threshold_fails() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    let result = client.try_set_verification_threshold(&admin, &0);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

// ── Historical Results ────────────────────────────────────────────────────────

#[test]
fn test_get_historical_results_count() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let source = Address::generate(&env);
    client.add_data_source(&admin, &source, &sport(&env, "ESPN"));
    for i in 0..5u32 {
        let event_id = if i == 0 {
            sport(&env, "EVT0")
        } else if i == 1 {
            sport(&env, "EVT1")
        } else if i == 2 {
            sport(&env, "EVT2")
        } else if i == 3 {
            sport(&env, "EVT3")
        } else {
            sport(&env, "EVT4")
        };
        client.submit_sports_data(
            &source,
            &sport(&env, "Football"),
            &event_id,
            &sport(&env, "TeamA"),
            &sport(&env, "TeamB"),
            &i,
            &0u32,
        );
    }
    assert_eq!(client.get_historical_results(&0, &3), 3);
    assert_eq!(client.get_historical_results(&3, &10), 2);
    assert_eq!(client.get_historical_results(&10, &5), 0);
}

// ── Not initialized ───────────────────────────────────────────────────────────

#[test]
fn test_operations_fail_when_not_initialized() {
    let (env, client, admin) = setup();
    let source = Address::generate(&env);
    let result = client.try_add_data_source(&admin, &source, &sport(&env, "ESPN"));
    assert_eq!(result, Err(Ok(Error::NotInitialized)));
}
