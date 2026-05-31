// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{SupplyChainOracle, SupplyChainOracleClient};
use crate::types::{Error, ShipmentStatus};

fn setup() -> (Env, SupplyChainOracleClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, SupplyChainOracle);
    let client = SupplyChainOracleClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, client, admin)
}

fn s(env: &Env, v: &str) -> String { String::from_str(env, v) }

fn submit(client: &SupplyChainOracleClient, env: &Env, source: &Address, ship_ref: &str) -> u32 {
    client.submit_logistics_data(source, &s(env, ship_ref), &s(env, "Origin"), &s(env, "Dest"))
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
    client.add_data_source(&admin, &src, &s(&env, "Carrier-1"));
    assert!(client.get_data_source(&src).active);
}

#[test]
fn test_add_duplicate_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    assert_eq!(
        client.try_add_data_source(&admin, &src, &s(&env, "C2")),
        Err(Ok(Error::SourceAlreadyExists))
    );
}

#[test]
fn test_remove_source() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    client.remove_data_source(&admin, &src);
    assert!(!client.get_data_source(&src).active);
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
fn test_submit_creates_shipment() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    assert_eq!(id, 0);
    assert_eq!(client.get_shipment_count(), 1);
    let ship = client.get_logistics_data(&id);
    assert_eq!(ship.status, ShipmentStatus::Created);
}

#[test]
fn test_submit_records_provenance() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    assert_eq!(client.get_provenance_count(&id), 1);
    let ev = client.get_provenance_data(&id, &0);
    assert_eq!(ev.shipment_id, 0);
}

#[test]
fn test_submit_unknown_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let unknown = Address::generate(&env);
    assert_eq!(
        client.try_submit_logistics_data(&unknown, &s(&env, "R1"), &s(&env, "O"), &s(&env, "D")),
        Err(Ok(Error::SourceNotFound))
    );
}

#[test]
fn test_submit_inactive_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    client.remove_data_source(&admin, &src);
    assert_eq!(
        client.try_submit_logistics_data(&src, &s(&env, "R1"), &s(&env, "O"), &s(&env, "D")),
        Err(Ok(Error::SourceInactive))
    );
}

#[test]
fn test_submit_empty_ref_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    assert_eq!(
        client.try_submit_logistics_data(&src, &s(&env, ""), &s(&env, "O"), &s(&env, "D")),
        Err(Ok(Error::InvalidShipmentRef))
    );
}

// ── Confirmation ──────────────────────────────────────────────────────────────

#[test]
fn test_confirm_auto_delivers() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &Some(2));
    let src1 = Address::generate(&env);
    let src2 = Address::generate(&env);
    client.add_data_source(&admin, &src1, &s(&env, "C1"));
    client.add_data_source(&admin, &src2, &s(&env, "C2"));
    let id = submit(&client, &env, &src1, "REF001");
    client.confirm_shipment(&src2, &id, &s(&env, "Port A"));
    assert_eq!(client.get_logistics_data(&id).status, ShipmentStatus::Delivered);
}

#[test]
fn test_confirm_records_provenance() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &Some(3));
    let src1 = Address::generate(&env);
    let src2 = Address::generate(&env);
    client.add_data_source(&admin, &src1, &s(&env, "C1"));
    client.add_data_source(&admin, &src2, &s(&env, "C2"));
    let id = submit(&client, &env, &src1, "REF001");
    client.confirm_shipment(&src2, &id, &s(&env, "Port A"));
    assert_eq!(client.get_provenance_count(&id), 2);
}

#[test]
fn test_confirm_inactive_source_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &Some(2));
    let src1 = Address::generate(&env);
    let src2 = Address::generate(&env);
    client.add_data_source(&admin, &src1, &s(&env, "C1"));
    client.add_data_source(&admin, &src2, &s(&env, "C2"));
    let id = submit(&client, &env, &src1, "REF001");
    client.remove_data_source(&admin, &src2);
    assert_eq!(
        client.try_confirm_shipment(&src2, &id, &s(&env, "Port A")),
        Err(Ok(Error::SourceInactive))
    );
}

// ── Status Update ─────────────────────────────────────────────────────────────

#[test]
fn test_update_status() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    client.update_status(&src, &id, &ShipmentStatus::InTransit, &s(&env, "Hub"));
    assert_eq!(client.get_logistics_data(&id).status, ShipmentStatus::InTransit);
}

#[test]
fn test_update_status_to_created_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    assert_eq!(
        client.try_update_status(&src, &id, &ShipmentStatus::Created, &s(&env, "Hub")),
        Err(Ok(Error::InvalidStatusTransition))
    );
}

#[test]
fn test_update_status_records_provenance() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    client.update_status(&src, &id, &ShipmentStatus::CustomsHold, &s(&env, "Customs"));
    assert_eq!(client.get_provenance_count(&id), 2);
}

// ── Finalization ──────────────────────────────────────────────────────────────

#[test]
fn test_finalize_shipment() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    client.finalize_shipment(&admin, &id);
    assert_eq!(client.get_logistics_data(&id).status, ShipmentStatus::Finalized);
}

#[test]
fn test_finalize_twice_fails() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    client.finalize_shipment(&admin, &id);
    assert_eq!(
        client.try_finalize_shipment(&admin, &id),
        Err(Ok(Error::ShipmentAlreadyFinalized))
    );
}

#[test]
fn test_cannot_update_finalized_shipment() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    let id = submit(&client, &env, &src, "REF001");
    client.finalize_shipment(&admin, &id);
    assert_eq!(
        client.try_update_status(&src, &id, &ShipmentStatus::InTransit, &s(&env, "Hub")),
        Err(Ok(Error::ShipmentAlreadyFinalized))
    );
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

#[test]
fn test_circuit_breaker_blocks_submit() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    client.set_circuit_breaker(&admin, &true);
    assert_eq!(
        client.try_submit_logistics_data(&src, &s(&env, "R1"), &s(&env, "O"), &s(&env, "D")),
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
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    client.pause(&admin);
    assert_eq!(
        client.try_submit_logistics_data(&src, &s(&env, "R1"), &s(&env, "O"), &s(&env, "D")),
        Err(Ok(Error::ContractPaused))
    );
}

#[test]
fn test_unpause_restores() {
    let (env, client, admin) = setup();
    client.initialize(&admin, &None);
    let src = Address::generate(&env);
    client.add_data_source(&admin, &src, &s(&env, "C1"));
    client.pause(&admin);
    client.unpause(&admin);
    let id = submit(&client, &env, &src, "REF001");
    assert_eq!(id, 0);
}

// ── Threshold ─────────────────────────────────────────────────────────────────

#[test]
fn test_set_threshold() {
    let (_, client, admin) = setup();
    client.initialize(&admin, &None);
    client.set_verification_threshold(&admin, &4);
    assert_eq!(client.get_threshold(), 4);
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
