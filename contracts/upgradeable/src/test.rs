// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::{Address as _, Ledger}, Address, BytesN, Env};

use crate::{Error, UpgradeableContract, UpgradeableContractClient};

fn setup() -> (Env, Address, UpgradeableContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, UpgradeableContract);
    let client = UpgradeableContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin, &None).unwrap();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin, &None).unwrap();
    assert_eq!(
        client.try_initialize(&admin, &None).unwrap_err().unwrap(),
        Error::AlreadyInitialized
    );
}

#[test]
fn test_initialize_sets_timelock() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin, &Some(100u32)).unwrap();
    assert_eq!(client.get_timelock(), 100);
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin, &None).unwrap();
    client.try_pause(&admin).unwrap();
    assert!(client.is_paused());
    client.try_unpause(&admin).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_non_admin_cannot_pause() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &None).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client.try_pause(&other).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

#[test]
fn test_propose_upgrade_blocked_when_paused() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &None).unwrap();
    client.try_pause(&admin).unwrap();
    let hash = BytesN::from_array(&env, &[0u8; 32]);
    assert_eq!(
        client.try_propose_upgrade(&admin, &hash).unwrap_err().unwrap(),
        Error::ContractPaused
    );
}

// ── upgrade (non-admin guard) ─────────────────────────────────────────────────

#[test]
fn test_non_admin_cannot_upgrade() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &None).unwrap();
    let other = Address::generate(&env);
    let hash = BytesN::from_array(&env, &[2u8; 32]);
    assert_eq!(
        client.try_propose_upgrade(&other, &hash).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

// ── timelock upgrade ──────────────────────────────────────────────────────────

#[test]
fn test_execute_upgrade_before_timelock_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &Some(10u32)).unwrap();
    let hash = BytesN::from_array(&env, &[3u8; 32]);
    client.try_propose_upgrade(&admin, &hash).unwrap();
    assert_eq!(
        client.try_execute_upgrade(&admin).unwrap_err().unwrap(),
        Error::TimelockNotElapsed
    );
}

#[test]
fn test_execute_upgrade_no_pending_fails() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin, &Some(10u32)).unwrap();
    assert_eq!(
        client.try_execute_upgrade(&admin).unwrap_err().unwrap(),
        Error::NoPendingUpgrade
    );
}

// ── pre-init guards ───────────────────────────────────────────────────────────

#[test]
fn test_pause_before_init_fails() {
    let (env, _admin, client) = setup();
    let caller = Address::generate(&env);
    assert_eq!(
        client.try_pause(&caller).unwrap_err().unwrap(),
        Error::NotInitialized
    );
}

#[test]
fn test_get_timelock_before_init_fails() {
    let (_env, _admin, client) = setup();
    assert_eq!(
        client.try_get_timelock().unwrap_err().unwrap(),
        Error::NotInitialized
    );
}

// ── pending upgrade state ─────────────────────────────────────────────────────

#[test]
fn test_get_pending_upgrade_none_initially() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin, &Some(10u32)).unwrap();
    assert!(client.get_pending_upgrade().is_none());
}

#[test]
fn test_get_pending_upgrade_some_after_propose() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &Some(10u32)).unwrap();
    let hash = BytesN::from_array(&env, &[5u8; 32]);
    client.try_propose_upgrade(&admin, &hash).unwrap();
    assert!(client.get_pending_upgrade().is_some());
}

#[test]
fn test_timelock_default_is_zero() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin, &None).unwrap();
    assert_eq!(client.get_timelock(), 0);
}

#[test]
fn test_propose_blocked_not_initialized() {
    let (env, _admin, client) = setup();
    let caller = Address::generate(&env);
    let hash = BytesN::from_array(&env, &[9u8; 32]);
    assert_eq!(
        client.try_propose_upgrade(&caller, &hash).unwrap_err().unwrap(),
        Error::NotInitialized
    );
}

#[test]
fn test_execute_blocked_not_initialized() {
    let (env, _admin, client) = setup();
    let caller = Address::generate(&env);
    assert_eq!(
        client.try_execute_upgrade(&caller).unwrap_err().unwrap(),
        Error::NotInitialized
    );
}

// ── ledger sequence advance helper ────────────────────────────────────────────

#[test]
fn test_ledger_sequence_advances() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &Some(5u32)).unwrap();
    let hash = BytesN::from_array(&env, &[4u8; 32]);
    client.try_propose_upgrade(&admin, &hash).unwrap();

    // Before timelock elapses → still blocked.
    assert_eq!(
        client.try_execute_upgrade(&admin).unwrap_err().unwrap(),
        Error::TimelockNotElapsed
    );

    // Advance ledger sequence past the timelock.
    env.ledger().with_mut(|l| l.sequence_number += 10);

    // After timelock: auth/timelock checks pass; WASM replacement panics in test
    // harness (no real WASM binary). We verify TimelockNotElapsed is NOT returned.
    let result = client.try_execute_upgrade(&admin);
    let err = result.unwrap_err();
    // Either InvokeError (host error from missing WASM), or Ok(contract error).
    // Either way, it must NOT be TimelockNotElapsed.
    if let Ok(contract_err) = err {
        assert_ne!(contract_err, Error::TimelockNotElapsed);
    }
    // An InvokeError (host error) also means timelock was passed → test passes.
}
