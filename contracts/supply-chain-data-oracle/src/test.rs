// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{SupplyChainDataOracle, SupplyChainDataOracleClient};
use crate::types::{Error, LogisticsStatus};

fn setup() -> (Env, SupplyChainDataOracleClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SupplyChainDataOracle);
    let client = SupplyChainDataOracleClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, client, admin)
}

fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

fn submit(client: &SupplyChainDataOracleClient, env: &Env, source: &Address, ship_id: &str) -> u32 {
    client.submit_logistics_data(
        source,
        &s(env, ship_id),
        &s(env, "Origin"),
        &s(env, "Dest"),
        &s(env, "Carrier"),
        &LogisticsStatus::InTransit,
        &250i32,
        &60u32,
    )
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    assert_eq!(client.try_initialize(&admin, &None), Err(Ok(Error::AlreadyInitialized)));
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
    assert_eq!(client.try_initialize(&admin, &Some(0)), Err(Ok(Error::InvalidThreshold)));
}

// ── Data Sources ──────────────────────────────────────────────────────────────

#[test]
fn test_add_source() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    assert!(client.get_data_source(&src).active);
}

#[test]
fn test_add_duplicate_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    assert_eq!(
        client.try_add_data_source(&admin, &src, &s(&env, "IoT-2")),
        Err(Ok(Error::SourceAlreadyExists))
    );
}

#[test]
fn test_remove_source() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    client.remove_data_source(&admin, &src);
    assert!(!client.get_data_source(&src).active);
}

#[test]
fn test_remove_nonexistent_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    assert_eq!(client.try_remove_data_source(&admin, &src), Err(Ok(Error::SourceNotFound)));
}

#[test]
fn test_non_admin_cannot_add_source() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let attacker = Address::generate(&env);
    let src = Address::generate(&env);
    assert_eq!(
        client.try_add_data_source(&attacker, &src, &s(&env, "Fake")),
        Err(Ok(Error::Unauthorized))
    );
}

// ── Submit Logistics Data ─────────────────────────────────────────────────────

#[test]
fn test_submit_logistics_data() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    let id = submit(&client, &env, &src, "SHIP001");
    assert_eq!(id, 0);
    assert_eq!(client.get_data_count(), 1);
}

#[test]
fn test_submit_increments_source_submissions() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    submit(&client, &env, &src, "SHIP001");
    assert_eq!(client.get_data_source(&src).submissions, 1);
}

#[test]
fn test_submit_unknown_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let unknown = Address::generate(&env);
    assert_eq!(
        client.try_submit_logistics_data(
            &unknown, &s(&env, "S1"), &s(&env, "O"), &s(&env, "D"),
            &s(&env, "C"), &LogisticsStatus::InTransit, &0i32, &50u32,
        ),
        Err(Ok(Error::SourceNotFound))
    );
}

#[test]
fn test_submit_inactive_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    client.remove_data_source(&admin, &src);
    assert_eq!(
        client.try_submit_logistics_data(
            &src, &s(&env, "S1"), &s(&env, "O"), &s(&env, "D"),
            &s(&env, "C"), &LogisticsStatus::InTransit, &0i32, &50u32,
        ),
        Err(Ok(Error::SourceInactive))
    );
}

#[test]
fn test_submit_empty_shipment_id_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    assert_eq!(
        client.try_submit_logistics_data(
            &src, &s(&env, ""), &s(&env, "O"), &s(&env, "D"),
            &s(&env, "C"), &LogisticsStatus::InTransit, &0i32, &50u32,
        ),
        Err(Ok(Error::InvalidShipmentId))
    );
}

#[test]
fn test_submit_invalid_humidity_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    assert_eq!(
        client.try_submit_logistics_data(
            &src, &s(&env, "S1"), &s(&env, "O"), &s(&env, "D"),
            &s(&env, "C"), &LogisticsStatus::InTransit, &0i32, &101u32,
        ),
        Err(Ok(Error::InvalidHumidity))
    );
}

// ── Confirmation & Verification ───────────────────────────────────────────────

#[test]
fn test_confirm_auto_verifies() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &Some(2));
    let src1 = Address::generate(&env);
    let src2 = Address::generate(&env);
    client.add_data_source(&admin, &src1, &s(&env, "IoT-1"));
    client.add_data_source(&admin, &src2, &s(&env, "IoT-2"));
    let id = submit(&client, &env, &src1, "SHIP001");
    client.confirm_logistics_data(&src2, &id);
    assert_eq!(client.get_logistics_data(&id).status, LogisticsStatus::Verified);
}

#[test]
fn test_confirm_inactive_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &Some(2));
    let src1 = Address::generate(&env);
    let src2 = Address::generate(&env);
    client.add_data_source(&admin, &src1, &s(&env, "IoT-1"));
    client.add_data_source(&admin, &src2, &s(&env, "IoT-2"));
    let id = submit(&client, &env, &src1, "SHIP001");
    client.remove_data_source(&admin, &src2);
    assert_eq!(
        client.try_confirm_logistics_data(&src2, &id),
        Err(Ok(Error::SourceInactive))
    );
}

// ── Finalization ──────────────────────────────────────────────────────────────

#[test]
fn test_finalize() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    let id = submit(&client, &env, &src, "SHIP001");
    client.finalize_logistics_data(&admin, &id);
    assert_eq!(client.get_logistics_data(&id).status, LogisticsStatus::Finalized);
}

#[test]
fn test_finalize_twice_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    let id = submit(&client, &env, &src, "SHIP001");
    client.finalize_logistics_data(&admin, &id);
    assert_eq!(
        client.try_finalize_logistics_data(&admin, &id),
        Err(Ok(Error::DataAlreadyFinalized))
    );
}

// ── Provenance ────────────────────────────────────────────────────────────────

#[test]
fn test_provenance_recorded_on_submit() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    submit(&client, &env, &src, "SHIP001");
    assert_eq!(client.get_provenance_count(&s(&env, "SHIP001")), 1);
    let rec = client.get_provenance_data(&s(&env, "SHIP001"), &0);
    assert_eq!(rec.data_id, 0);
}

#[test]
fn test_provenance_missing_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    assert_eq!(
        client.try_get_provenance_data(&s(&env, "NONE"), &0),
        Err(Ok(Error::DataNotFound))
    );
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

#[test]
fn test_circuit_breaker_blocks_submit() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    client.set_circuit_breaker(&admin, &true);
    assert_eq!(
        client.try_submit_logistics_data(
            &src, &s(&env, "S1"), &s(&env, "O"), &s(&env, "D"),
            &s(&env, "C"), &LogisticsStatus::InTransit, &0i32, &50u32,
        ),
        Err(Ok(Error::CircuitBreakerActive))
    );
}

#[test]
fn test_circuit_breaker_toggle() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    client.set_circuit_breaker(&admin, &true);
    assert!(client.is_circuit_breaker_active());
    client.set_circuit_breaker(&admin, &false);
    assert!(!client.is_circuit_breaker_active());
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_submit() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    client.pause(&admin);
    assert_eq!(
        client.try_submit_logistics_data(
            &src, &s(&env, "S1"), &s(&env, "O"), &s(&env, "D"),
            &s(&env, "C"), &LogisticsStatus::InTransit, &0i32, &50u32,
        ),
        Err(Ok(Error::ContractPaused))
    );
}

#[test]
fn test_unpause_restores() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "IoT-1"));
    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());
    let id = submit(&client, &env, &src, "SHIP001");
    assert_eq!(id, 0);
}

// ── Threshold ─────────────────────────────────────────────────────────────────

#[test]
fn test_set_threshold() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    client.set_verification_threshold(&admin, &5);
    assert_eq!(client.get_threshold(), 5);
}

#[test]
fn test_set_zero_threshold_fails() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    assert_eq!(
        client.try_set_verification_threshold(&admin, &0),
        Err(Ok(Error::InvalidThreshold))
    );
}

// ── Not initialized ───────────────────────────────────────────────────────────

#[test]
fn test_not_initialized_fails() {
    let (env, client, admin) = setup();
    let src = Address::generate(&env);
    assert_eq!(
        client.try_add_data_source(&admin, &src, &s(&env, "X")),
        Err(Ok(Error::NotInitialized))
    );
}
