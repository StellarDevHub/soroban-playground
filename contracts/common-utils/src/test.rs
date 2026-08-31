// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{storage::Instance, storage::Persistent, Ledger},
    Address, Env, Symbol,
};

use crate::storage::{EXTEND_LIMIT, LEDGER_THRESHOLD};
use crate::{CommonUtils, CommonUtilsClient};

/// Creates an environment with explicit, readable TTL-related network settings
/// (the SDK defaults are arbitrary and not obvious to readers).
///
/// `min_persistent_entry_ttl` also governs the *contract instance's* TTL. Tests
/// that advance the ledger far forward to age entries must set it high enough
/// that the contract instance itself stays alive through the advance.
fn create_env(min_persistent_entry_ttl: u32) -> Env {
    let env = Env::default();
    env.ledger().with_mut(|li| {
        // Expose the TTL as a count of ledgers relative to this sequence.
        li.sequence_number = 100_000;
        // New persistent/instance entries (incl. the contract instance) get this TTL.
        li.min_persistent_entry_ttl = min_persistent_entry_ttl;
        // New temporary entries start with this TTL (minus current ledger).
        li.min_temp_entry_ttl = 100;
        // Each extension may be at most `max_entry_ttl` ledgers from `sequence_number`;
        // set high enough that our 500k extends still fit within range.
        li.max_entry_ttl = 1_000_000;
    });
    env
}

fn setup_with(min_persistent_entry_ttl: u32) -> (Env, CommonUtilsClient<'static>, Address) {
    let env = create_env(min_persistent_entry_ttl);
    let contract_id = env.register_contract(None, CommonUtils);
    let client = CommonUtilsClient::new(&env, &contract_id);
    (env, client, contract_id)
}

const P: Symbol = symbol_short!("BAL");
const I: Symbol = symbol_short!("CFG");

// ── Constants ─────────────────────────────────────────────────────────────────

#[test]
fn test_constants_match_spec() {
    // ~5.7 days @ 5s/ledger and ~28 days @ 5s/ledger.
    assert_eq!(LEDGER_THRESHOLD, 100_000);
    assert_eq!(EXTEND_LIMIT, 500_000);
    assert!(EXTEND_LIMIT > LEDGER_THRESHOLD);
}

// ── Persistent storage ────────────────────────────────────────────────────────

#[test]
fn test_persistent_write_extends_ttl() {
    let (env, client, contract_id) = setup_with(500);

    client.persistent_write(&P, &500);

    // With min TTL 500, a plain create would be ~499; our write extends it to
    // exactly EXTEND_LIMIT, proving the auto-extension on write.
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().persistent().get_ttl(&P), 500_000);
    });
    assert_eq!(client.persistent_read(&P), 500);
}

#[test]
fn test_persistent_read_extends_ttl_when_below_threshold() {
    // Large min TTL so the contract instance stays alive through the ledger bump.
    let (env, client, contract_id) = setup_with(500_000);

    client.persistent_write(&P, &100); // entry TTL 500_000

    // Advance so the remaining TTL (~50k) drops below the 100k threshold. Note the
    // created entry reports TTL - 1 (the current ledger counts toward the TTL).
    env.ledger().with_mut(|li| li.sequence_number += 450_000);
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().persistent().get_ttl(&P), 49_999);
    });

    // A read whose TTL is below the threshold auto-extends back to EXTEND_LIMIT.
    assert_eq!(client.persistent_read(&P), 100);
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().persistent().get_ttl(&P), 500_000);
    });
}

#[test]
fn test_persistent_read_does_not_extend_above_threshold() {
    let (env, client, contract_id) = setup_with(500_000);

    client.persistent_write(&P, &7); // entry TTL 500_000

    // Advance so remaining TTL (~450k) is still above the 100k threshold (TTL - 1).
    env.ledger().with_mut(|li| li.sequence_number += 50_000);
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().persistent().get_ttl(&P), 449_999);
    });

    // Reading above the threshold must NOT bump the TTL (stays ~450k).
    assert_eq!(client.persistent_read(&P), 7);
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().persistent().get_ttl(&P), 449_999);
    });
}

// ── Instance storage ──────────────────────────────────────────────────────────

#[test]
fn test_instance_write_extends_ttl() {
    let (env, client, contract_id) = setup_with(500);

    client.instance_write(&I, &10);

    // With min TTL 500, a plain create would be ~499; our write extends the
    // instance TTL to exactly EXTEND_LIMIT, proving the auto-extension on write.
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().instance().get_ttl(), 500_000);
    });
    assert_eq!(client.instance_read(&I), 10);
}

#[test]
fn test_instance_read_extends_ttl_when_below_threshold() {
    let (env, client, contract_id) = setup_with(500_000);

    client.instance_write(&I, &10); // instance TTL 500_000

    env.ledger().with_mut(|li| li.sequence_number += 450_000);
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().instance().get_ttl(), 49_999);
    });

    // Reading below the threshold re-bumps the instance TTL back to EXTEND_LIMIT.
    assert_eq!(client.instance_read(&I), 10);
    env.as_contract(&contract_id, || {
        assert_eq!(env.storage().instance().get_ttl(), 500_000);
    });
}

// ── Round-trips & removal ─────────────────────────────────────────────────────

#[test]
fn test_persistent_roundtrip_and_remove() {
    let (env, client, contract_id) = setup_with(500);

    client.persistent_write(&P, &42);
    assert_eq!(client.persistent_read(&P), 42);

    env.as_contract(&contract_id, || {
        env.storage().persistent().remove(&P);
    });
    let exists = env.as_contract(&contract_id, || env.storage().persistent().has(&P));
    assert!(!exists);
    assert_eq!(client.persistent_read(&P), 0);
}

#[test]
fn test_missing_keys_read_as_default() {
    let (_, client, _) = setup_with(500);
    assert_eq!(client.persistent_read(&P), 0);
    assert_eq!(client.instance_read(&I), 0);
}