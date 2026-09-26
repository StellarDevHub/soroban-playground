// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, BytesN, Env, String, Vec,
};

extern crate std;

// ── Helpers ──────────────────────────────────────────────────────────────────

fn make_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn register(env: &Env) -> MultisigWalletClient<'static> {
    let id = env.register_contract(None, MultisigWallet);
    MultisigWalletClient::new(env, &id)
}

fn make_owners(env: &Env, n: usize) -> Vec<Address> {
    let mut v = Vec::new(env);
    for _ in 0..n {
        v.push_back(Address::generate(env));
    }
    v
}

fn init(
    env: &Env,
    n: usize,
    threshold: u32,
    min_delay: u64,
    max_delay: u64,
) -> (MultisigWalletClient<'static>, Vec<Address>) {
    let client = register(env);
    let owners = make_owners(env, n);
    client.initialize(&owners, &threshold, &min_delay, &max_delay);
    (client, owners)
}

fn str5(env: &Env) -> String {
    String::from_str(env, "hello")
}

fn str_empty(env: &Env) -> String {
    String::from_str(env, "")
}

fn str_long(env: &Env) -> String {
    // > MAX_DATA_LENGTH (256)
    str_n(env, 300)
}

fn str_at(env: &Env, n: usize) -> String {
    str_n(env, n)
}

fn str_n(env: &Env, n: usize) -> String {
    // Build a string of exactly `n` bytes via repeated from_str and concatenation
    // through Bytes. Soroban SDK 21 has no String::concat, so we use a fixed
    // 1-byte chunk and count.
    let mut b = soroban_sdk::Bytes::new(env);
    for _ in 0..n {
        b.push_back(0u8);
    }
    // Bytes implements IntoIterator yielding u8 in testutils builds? We instead
    // serialise the bytes into a local heap-less buffer.
    let mut arr = [0u8; 512];
    if n <= arr.len() {
        for slot in arr.iter_mut().take(n) {
            *slot = 0u8;
        }
        String::from_bytes(env, &arr[..n])
    } else {
        // Fallback: cap at 512.
        String::from_bytes(env, &arr[..512])
    }
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
}

// ── 1. Initialisation ─────────────────────────────────────────────────────────

#[test]
fn test_init_basic() {
    let env = make_env();
    let owners = make_owners(&env, 3);
    let client = register(&env);
    client.initialize(&owners, &2, &0, &0);
    assert_eq!(client.get_owner_count(), 3);
    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_min_delay(), 0);
    assert_eq!(client.get_max_delay(), 0);
    assert_eq!(client.get_transaction_count(), 0);
}

#[test]
fn test_init_single_owner() {
    let env = make_env();
    let owners = make_owners(&env, 1);
    let client = register(&env);
    client.initialize(&owners, &1, &0, &0);
    assert_eq!(client.get_owner_count(), 1);
    assert!(client.is_owner(&owners.get_unchecked(0)));
}

#[test]
fn test_init_double_fails() {
    let env = make_env();
    let owners = make_owners(&env, 2);
    let client = register(&env);
    client.initialize(&owners, &1, &0, &0);
    let err = client.try_initialize(&owners, &1, &0, &0).unwrap_err();
    assert_eq!(err, Ok(Error::AlreadyInitialized));
}

#[test]
fn test_init_empty_owners_fails() {
    let env = make_env();
    let client = register(&env);
    let owners = Vec::new(&env);
    let err = client.try_initialize(&owners, &1, &0, &0).unwrap_err();
    assert_eq!(err, Ok(Error::OwnerRequired));
}

#[test]
fn test_init_threshold_zero_fails() {
    let env = make_env();
    let owners = make_owners(&env, 2);
    let client = register(&env);
    let err = client.try_initialize(&owners, &0, &0, &0).unwrap_err();
    assert_eq!(err, Ok(Error::InvalidThreshold));
}

#[test]
fn test_init_threshold_gt_owners_fails() {
    let env = make_env();
    let owners = make_owners(&env, 2);
    let client = register(&env);
    let err = client.try_initialize(&owners, &3, &0, &0).unwrap_err();
    assert_eq!(err, Ok(Error::InvalidThreshold));
}

#[test]
fn test_init_duplicate_owners_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let mut owners = Vec::new(&env);
    owners.push_back(a.clone());
    owners.push_back(a);
    let err = client.try_initialize(&owners, &1, &0, &0).unwrap_err();
    assert_eq!(err, Ok(Error::DuplicateOwner));
}

#[test]
fn test_init_min_gt_max_fails() {
    let env = make_env();
    let owners = make_owners(&env, 2);
    let client = register(&env);
    let err = client.try_initialize(&owners, &1, &10, &5).unwrap_err();
    assert_eq!(err, Ok(Error::InvalidDelay));
}

#[test]
fn test_init_min_eq_max_ok() {
    let env = make_env();
    let owners = make_owners(&env, 2);
    let client = register(&env);
    client.initialize(&owners, &1, &5, &5);
    assert_eq!(client.get_min_delay(), 5);
    assert_eq!(client.get_max_delay(), 5);
}

#[test]
fn test_init_get_owners_returns_all() {
    let env = make_env();
    let owners = make_owners(&env, 4);
    let client = register(&env);
    client.initialize(&owners, &3, &0, &0);
    let stored = client.get_owners();
    assert_eq!(stored.len(), 4);
    for o in owners.iter() {
        assert!(stored.contains(&o));
    }
}

#[test]
fn test_init_is_owner_for_each() {
    let env = make_env();
    let owners = make_owners(&env, 3);
    let client = register(&env);
    client.initialize(&owners, &2, &0, &0);
    for o in owners.iter() {
        assert!(client.is_owner(&o));
    }
    let stranger = Address::generate(&env);
    assert!(!client.is_owner(&stranger));
}

// ── 2. add_owner ──────────────────────────────────────────────────────────────

#[test]
fn test_add_owner_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let new = Address::generate(&env);
    client.add_owner(&owners.get_unchecked(0), &new);
    assert_eq!(client.get_owner_count(), 3);
    assert!(client.is_owner(&new));
}

#[test]
fn test_add_owner_appears_in_list() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let new = Address::generate(&env);
    client.add_owner(&owners.get_unchecked(0), &new);
    let list = client.get_owners();
    assert!(list.contains(&new));
    assert_eq!(list.len(), 3);
}

#[test]
fn test_add_owner_duplicate_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let err = client
        .try_add_owner(&owners.get_unchecked(0), &owners.get_unchecked(1))
        .unwrap_err();
    assert_eq!(err, Ok(Error::OwnerExists));
}

#[test]
fn test_add_owner_non_owner_fails() {
    let env = make_env();
    let (client, _owners) = init(&env, 2, 1, 0, 0);
    let stranger = Address::generate(&env);
    let new = Address::generate(&env);
    let err = client.try_add_owner(&stranger, &new).unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_add_owner_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let err = client.try_add_owner(&a, &b).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

#[test]
fn test_add_owner_multiple() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let c = Address::generate(&env);
    let caller = owners.get_unchecked(0);
    client.add_owner(&caller, &a);
    client.add_owner(&caller, &b);
    client.add_owner(&caller, &c);
    assert_eq!(client.get_owner_count(), 5);
}

#[test]
fn test_add_owner_can_increase_threshold() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 0, 0);
    let caller = owners.get_unchecked(0);
    let new = Address::generate(&env);
    client.add_owner(&caller, &new);
    assert_eq!(client.get_owner_count(), 3);
    // Now threshold of 2 is satisfiable with 3 owners.
    assert!(client.try_change_threshold(&caller, &3).is_ok());
}

#[test]
fn test_add_owner_not_incremented_on_failure() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    let new = Address::generate(&env);
    // Duplicate attempt: owners.get(1) is already an owner.
    let _ = client.try_add_owner(&caller, &owners.get_unchecked(1));
    client.add_owner(&caller, &new);
    // count should be 3, not 4.
    assert_eq!(client.get_owner_count(), 3);
}

// ── 3. remove_owner ───────────────────────────────────────────────────────────

#[test]
fn test_remove_owner_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    let target = owners.get_unchecked(1);
    client.remove_owner(&caller, &target);
    assert_eq!(client.get_owner_count(), 2);
    assert!(!client.is_owner(&target));
}

#[test]
fn test_remove_owner_self_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    let err = client.try_remove_owner(&caller, &caller).unwrap_err();
    assert_eq!(err, Ok(Error::SelfRemoval));
}

#[test]
fn test_remove_owner_non_owner_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    let stranger = Address::generate(&env);
    let err = client.try_remove_owner(&caller, &stranger).unwrap_err();
    assert_eq!(err, Ok(Error::OwnerNotFound));
}

#[test]
fn test_remove_owner_below_threshold_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 3, 0, 0);
    let caller = owners.get_unchecked(0);
    let err = client
        .try_remove_owner(&caller, &owners.get_unchecked(1))
        .unwrap_err();
    assert_eq!(err, Ok(Error::InvalidThreshold));
}

#[test]
fn test_remove_owner_caller_unauthorized() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let stranger = Address::generate(&env);
    let err = client
        .try_remove_owner(&stranger, &owners.get_unchecked(1))
        .unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_remove_owner_then_readd() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let caller = owners.get_unchecked(0);
    let target = owners.get_unchecked(1);
    client.remove_owner(&caller, &target);
    assert_eq!(client.get_owner_count(), 2);
    // Re-adding should work.
    client.add_owner(&caller, &target);
    assert!(client.is_owner(&target));
    assert_eq!(client.get_owner_count(), 3);
}

#[test]
fn test_remove_owner_keeps_remaining_list_consistent() {
    let env = make_env();
    let (client, owners) = init(&env, 4, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    // Remove owner at index 1.
    let target = owners.get_unchecked(1);
    client.remove_owner(&caller, &target);
    let list = client.get_owners();
    assert_eq!(list.len(), 3);
    for o in owners.iter() {
        if o != target {
            assert!(list.contains(&o));
        }
    }
    assert!(!list.contains(&target));
}

#[test]
fn test_remove_owner_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let err = client.try_remove_owner(&a, &b).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

// ── 4. change_threshold ───────────────────────────────────────────────────────

#[test]
fn test_change_threshold_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    client.change_threshold(&caller, &3);
    assert_eq!(client.get_threshold(), 3);
}

#[test]
fn test_change_threshold_zero_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    let err = client.try_change_threshold(&caller, &0).unwrap_err();
    assert_eq!(err, Ok(Error::InvalidThreshold));
}

#[test]
fn test_change_threshold_too_high_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    let err = client.try_change_threshold(&caller, &4).unwrap_err();
    assert_eq!(err, Ok(Error::InvalidThreshold));
}

#[test]
fn test_change_threshold_non_owner_fails() {
    let env = make_env();
    let (client, _owners) = init(&env, 3, 1, 0, 0);
    let stranger = Address::generate(&env);
    let err = client.try_change_threshold(&stranger, &2).unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_change_threshold_to_count_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let caller = owners.get_unchecked(0);
    client.change_threshold(&caller, &3);
    assert_eq!(client.get_threshold(), 3);
}

#[test]
fn test_change_threshold_blocks_subsequent_remove() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let caller = owners.get_unchecked(0);
    // Raise threshold to 3, then attempt to remove (which would leave 2).
    client.change_threshold(&caller, &3);
    let err = client
        .try_remove_owner(&caller, &owners.get_unchecked(1))
        .unwrap_err();
    assert_eq!(err, Ok(Error::InvalidThreshold));
}

// ── 5. update_delays ──────────────────────────────────────────────────────────

#[test]
fn test_update_delays_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 100);
    let caller = owners.get_unchecked(0);
    client.update_delays(&caller, &10, &200);
    assert_eq!(client.get_min_delay(), 10);
    assert_eq!(client.get_max_delay(), 200);
}

#[test]
fn test_update_delays_inverted_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 100);
    let caller = owners.get_unchecked(0);
    let err = client.try_update_delays(&caller, &200, &100).unwrap_err();
    assert_eq!(err, Ok(Error::InvalidDelay));
}

#[test]
fn test_update_delays_non_owner_fails() {
    let env = make_env();
    let (client, _owners) = init(&env, 2, 1, 0, 100);
    let stranger = Address::generate(&env);
    let err = client.try_update_delays(&stranger, &10, &200).unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_update_delays_equal_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 5, 5);
    let caller = owners.get_unchecked(0);
    client.update_delays(&caller, &42, &42);
    assert_eq!(client.get_min_delay(), 42);
    assert_eq!(client.get_max_delay(), 42);
}

#[test]
fn test_update_delays_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let err = client.try_update_delays(&a, &1, &2).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

// ── 6. submit_transaction ─────────────────────────────────────────────────────

#[test]
fn test_submit_basic() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&proposer, &target, &100, &str5(&env), &0);
    assert_eq!(id, 0);
    assert_eq!(client.get_transaction_count(), 1);
}

#[test]
fn test_submit_increments_id() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id0 = client.submit_transaction(&proposer, &target, &1, &str5(&env), &0);
    let id1 = client.submit_transaction(&proposer, &target, &2, &str5(&env), &0);
    let id2 = client.submit_transaction(&proposer, &target, &3, &str5(&env), &0);
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_transaction_count(), 3);
}

#[test]
fn test_submit_non_owner_fails() {
    let env = make_env();
    let (client, _owners) = init(&env, 2, 1, 0, 0);
    let stranger = Address::generate(&env);
    let target = Address::generate(&env);
    let err = client
        .try_submit_transaction(&stranger, &target, &0, &str5(&env), &0)
        .unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_submit_negative_value_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let err = client
        .try_submit_transaction(&proposer, &target, &-1, &str5(&env), &0)
        .unwrap_err();
    assert_eq!(err, Ok(Error::InvalidValue));
}

#[test]
fn test_submit_empty_data_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let err = client
        .try_submit_transaction(&proposer, &target, &0, &str_empty(&env), &0)
        .unwrap_err();
    assert_eq!(err, Ok(Error::EmptyData));
}

#[test]
fn test_submit_data_too_long_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let err = client
        .try_submit_transaction(&proposer, &target, &0, &str_long(&env), &0)
        .unwrap_err();
    assert_eq!(err, Ok(Error::DataTooLong));
}

#[test]
fn test_submit_delay_below_min_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 10, 100);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let err = client
        .try_submit_transaction(&proposer, &target, &0, &str5(&env), &5)
        .unwrap_err();
    assert_eq!(err, Ok(Error::InvalidDelay));
}

#[test]
fn test_submit_delay_above_max_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 10, 100);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let err = client
        .try_submit_transaction(&proposer, &target, &0, &str5(&env), &200)
        .unwrap_err();
    assert_eq!(err, Ok(Error::InvalidDelay));
}

#[test]
fn test_submit_delay_at_boundaries_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 10, 100);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id_min = client.submit_transaction(&proposer, &target, &0, &str5(&env), &10);
    let id_max = client.submit_transaction(&proposer, &target, &0, &str5(&env), &100);
    assert_eq!(id_min, 0);
    assert_eq!(id_max, 1);
}

#[test]
fn test_submit_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let b = Address::generate(&env);
    let err = client
        .try_submit_transaction(&a, &b, &0, &str5(&env), &0)
        .unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

// ── 7. confirm_transaction ────────────────────────────────────────────────────

#[test]
fn test_confirm_single_owner_threshold1() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let proposer = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&proposer, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&proposer, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    assert_eq!(tx.confirmations, 1);
}

#[test]
fn test_confirm_below_threshold_stays_pending() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 3, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Pending);
    assert_eq!(tx.confirmations, 1);
}

#[test]
fn test_confirm_reaches_ready_at_threshold() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 100);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &10);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    assert_eq!(tx.confirmations, 2);
    assert!(tx.execute_after > 0);
}

#[test]
fn test_confirm_duplicate_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    let err = client.try_confirm_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::AlreadyConfirmed));
}

#[test]
fn test_confirm_non_owner_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let stranger = Address::generate(&env);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let err = client.try_confirm_transaction(&stranger, &id).unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_confirm_after_cancel_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.cancel_transaction(&a, &id);
    let err = client.try_confirm_transaction(&b, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_confirm_nonexistent_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let err = client.try_confirm_transaction(&a, &999).unwrap_err();
    assert_eq!(err, Ok(Error::TransactionNotFound));
}

#[test]
fn test_confirm_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let err = client.try_confirm_transaction(&a, &0).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

#[test]
fn test_is_confirmed_reflects_state() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    assert!(!client.is_confirmed(&id, &a));
    client.confirm_transaction(&a, &id);
    assert!(client.is_confirmed(&id, &a));
}

// ── 8. revoke_confirmation ────────────────────────────────────────────────────

#[test]
fn test_revoke_pending() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 3, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.revoke_confirmation(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Pending);
    assert_eq!(tx.confirmations, 0);
}

#[test]
fn test_revoke_drops_ready_to_pending() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    client.revoke_confirmation(&b, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Pending);
    assert_eq!(tx.confirmations, 1);
    assert_eq!(tx.execute_after, 0);
}

#[test]
fn test_revoke_when_not_confirmed_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    let err = client.try_revoke_confirmation(&b, &id).unwrap_err();
    assert_eq!(err, Ok(Error::NotConfirmed));
}

#[test]
fn test_revoke_non_owner_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    let stranger = Address::generate(&env);
    let err = client.try_revoke_confirmation(&stranger, &id).unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_revoke_cancelled_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.cancel_transaction(&a, &id);
    let err = client.try_revoke_confirmation(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_revoke_executed_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.execute_transaction(&a, &id);
    let err = client.try_revoke_confirmation(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_revoke_then_reconfirm() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    client.revoke_confirmation(&b, &id);
    client.confirm_transaction(&b, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    assert_eq!(tx.confirmations, 2);
}

#[test]
fn test_revoke_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let err = client.try_revoke_confirmation(&a, &0).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

// ── 9. execute_transaction ────────────────────────────────────────────────────

#[test]
fn test_execute_after_delay_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 10, 100);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &10);
    client.confirm_transaction(&a, &id);
    advance(&env, 10);
    client.execute_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Executed);
}

#[test]
fn test_execute_before_delay_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 10, 100);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &10);
    client.confirm_transaction(&a, &id);
    advance(&env, 9);
    let err = client.try_execute_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::DelayNotElapsed));
}

#[test]
fn test_execute_on_pending_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 3, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let err = client.try_execute_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_execute_on_cancelled_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.cancel_transaction(&a, &id);
    let err = client.try_execute_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_execute_twice_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.execute_transaction(&a, &id);
    let err = client.try_execute_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_execute_non_owner_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    let stranger = Address::generate(&env);
    let err = client.try_execute_transaction(&stranger, &id).unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_execute_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let err = client.try_execute_transaction(&a, &0).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

// ── 10. cancel_transaction ────────────────────────────────────────────────────

#[test]
fn test_cancel_pending_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.cancel_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Cancelled);
}

#[test]
fn test_cancel_ready_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    client.cancel_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Cancelled);
}

#[test]
fn test_cancel_executed_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.execute_transaction(&a, &id);
    let err = client.try_cancel_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_cancel_cancelled_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.cancel_transaction(&a, &id);
    let err = client.try_cancel_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_cancel_by_non_proposer_owner() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    // `b` is an owner (not proposer) and can still cancel.
    client.cancel_transaction(&b, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Cancelled);
}

#[test]
fn test_cancel_non_owner_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let stranger = Address::generate(&env);
    let err = client.try_cancel_transaction(&stranger, &id).unwrap_err();
    assert_eq!(err, Ok(Error::Unauthorized));
}

#[test]
fn test_cancel_uninitialized_fails() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let err = client.try_cancel_transaction(&a, &0).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

// ── 11. Read-only queries ────────────────────────────────────────────────────

#[test]
fn test_get_threshold() {
    let env = make_env();
    let (client, _owners) = init(&env, 3, 2, 0, 0);
    assert_eq!(client.get_threshold(), 2);
}

#[test]
fn test_get_min_max_delay() {
    let env = make_env();
    let (client, _owners) = init(&env, 2, 1, 7, 70);
    assert_eq!(client.get_min_delay(), 7);
    assert_eq!(client.get_max_delay(), 70);
}

#[test]
fn test_get_transaction_returns_submitted() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &42, &str5(&env), &0);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.id, id);
    assert_eq!(tx.proposer, a);
    assert_eq!(tx.target, target);
    assert_eq!(tx.value, 42);
    assert_eq!(tx.status, TxStatus::Pending);
}

#[test]
fn test_get_transaction_nonexistent() {
    let env = make_env();
    let (client, _owners) = init(&env, 2, 1, 0, 0);
    let err = client.try_get_transaction(&999).unwrap_err();
    assert_eq!(err, Ok(Error::TransactionNotFound));
}

#[test]
fn test_get_transaction_count() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    assert_eq!(client.get_transaction_count(), 0);
    client.submit_transaction(&a, &target, &1, &str5(&env), &0);
    client.submit_transaction(&a, &target, &2, &str5(&env), &0);
    assert_eq!(client.get_transaction_count(), 2);
}

#[test]
fn test_get_owner_count_uninitialized() {
    let env = make_env();
    let client = register(&env);
    let err = client.try_get_owner_count().unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

#[test]
fn test_is_owner_uninitialized() {
    let env = make_env();
    let client = register(&env);
    let a = Address::generate(&env);
    let err = client.try_is_owner(&a).unwrap_err();
    assert_eq!(err, Ok(Error::NotInitialized));
}

// ── 12. Integration scenarios ────────────────────────────────────────────────

#[test]
fn test_full_2_of_3_happy_path() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let c = owners.get_unchecked(2);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &100, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    // a+b → Ready; c is not needed.
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    client.execute_transaction(&c, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Executed);
}

#[test]
fn test_full_3_of_5_with_delay() {
    let env = make_env();
    let (client, owners) = init(&env, 5, 3, 100, 1000);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let c = owners.get_unchecked(2);
    let d = owners.get_unchecked(3);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &500);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    client.confirm_transaction(&c, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    // d was not asked.
    advance(&env, 500);
    client.execute_transaction(&d, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Executed);
}

#[test]
fn test_revoke_and_reconfirm_cycle() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let c = owners.get_unchecked(2);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    client.revoke_confirmation(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Pending);
    assert_eq!(tx.confirmations, 1);
    // b already confirmed; adding c brings us to threshold again.
    client.confirm_transaction(&c, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    assert_eq!(tx.confirmations, 2);
}

#[test]
fn test_cancel_before_threshold() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 3, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.cancel_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Cancelled);
}

#[test]
fn test_cancel_after_threshold_during_delay() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 100, 1000);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &500);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    // Cancel during delay window.
    client.cancel_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Cancelled);
    // Execute must now fail.
    advance(&env, 600);
    let err = client.try_execute_transaction(&a, &id).unwrap_err();
    assert_eq!(err, Ok(Error::WrongStatus));
}

#[test]
fn test_threshold_increase_blocks_subsequent_submits_needing_more() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let c = owners.get_unchecked(2);
    let target = Address::generate(&env);
    // Raise threshold to 3.
    client.change_threshold(&a, &3);
    // Submit + 1 confirm + 1 more = Ready, since 3-of-3 with 3 owners.
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    client.confirm_transaction(&b, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Pending);
    client.confirm_transaction(&c, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
}

#[test]
fn test_threshold_decrease_allows_fewer_confirms() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 3, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    client.change_threshold(&a, &1);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
}

#[test]
fn test_multiple_concurrent_proposals() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    let target = Address::generate(&env);
    let id0 = client.submit_transaction(&a, &target, &1, &str5(&env), &0);
    let id1 = client.submit_transaction(&a, &target, &2, &str5(&env), &0);
    let id2 = client.submit_transaction(&b, &target, &3, &str5(&env), &0);
    client.confirm_transaction(&a, &id0);
    client.confirm_transaction(&b, &id0);
    client.confirm_transaction(&b, &id1);
    client.confirm_transaction(&a, &id1);
    client.confirm_transaction(&a, &id2);
    client.confirm_transaction(&b, &id2);
    assert_eq!(client.get_transaction(&id0).status, TxStatus::Ready);
    assert_eq!(client.get_transaction(&id1).status, TxStatus::Ready);
    assert_eq!(client.get_transaction(&id2).status, TxStatus::Ready);
}

#[test]
fn test_init_with_existing_owners_then_remove() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 2, 0, 0);
    let a = owners.get_unchecked(0);
    client.remove_owner(&a, &owners.get_unchecked(1));
    let list = client.get_owners();
    assert_eq!(list.len(), 2);
    assert!(list.contains(&a));
    assert!(list.contains(owners.get_unchecked(2)));
}

#[test]
fn test_data_at_max_length_ok() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    // Exactly 256 bytes.
    let s = str_at(&env, 256);
    let id = client.submit_transaction(&a, &target, &0, &s, &0);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.data, s);
}

#[test]
fn test_data_one_over_max_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let s = str_at(&env, 257);
    let err = client
        .try_submit_transaction(&a, &target, &0, &s, &0)
        .unwrap_err();
    assert_eq!(err, Ok(Error::DataTooLong));
}

#[test]
fn test_init_with_5_owners_and_threshold_5() {
    let env = make_env();
    let (client, owners) = init(&env, 5, 5, 0, 0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&owners.get_unchecked(0), &target, &0, &str5(&env), &0);
    for o in owners.iter() {
        client.confirm_transaction(&o, &id);
    }
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    assert_eq!(tx.confirmations, 5);
}

#[test]
fn test_zero_delay_submit_and_execute() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    // No time advance needed.
    client.execute_transaction(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Executed);
}

// ── Weight-based signers (issue #1559) ───────────────────────────────────────

#[test]
fn test_owner_weight_defaults_to_one() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    assert_eq!(client.get_owner_weight(&owners.get_unchecked(0)), 1);
}

#[test]
fn test_weighted_confirmation_reaches_threshold() {
    let env = make_env();
    let (client, owners) = init(&env, 3, 3, 0, 0);
    let heavy = owners.get_unchecked(0);
    client.set_owner_weight(&heavy, &heavy, &3);
    assert_eq!(client.get_owner_weight(&heavy), 3);

    let target = Address::generate(&env);
    let id = client.submit_transaction(&heavy, &target, &0, &str5(&env), &0);
    // One confirmation carries weight 3 ≥ threshold 3.
    client.confirm_transaction(&heavy, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    assert_eq!(tx.confirmation_weight, 3);
}

#[test]
fn test_set_owner_weight_rejects_zero() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let result = client.try_set_owner_weight(&a, &a, &0);
    assert_eq!(result, Err(Ok(Error::InvalidWeight)));
}

#[test]
fn test_set_owner_weight_requires_owner() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let stranger = Address::generate(&env);
    let result = client.try_set_owner_weight(&stranger, &owners.get_unchecked(0), &2);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_revoke_subtracts_weight_and_drops_ready() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 2, 0, 0);
    let a = owners.get_unchecked(0);
    let b = owners.get_unchecked(1);
    client.set_owner_weight(&a, &a, &2);

    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id);
    assert_eq!(client.get_transaction(&id).status, TxStatus::Ready);

    client.revoke_confirmation(&a, &id);
    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Pending);
    assert_eq!(tx.confirmation_weight, 0);

    // The other owner's default weight alone cannot ready it.
    client.confirm_transaction(&b, &id);
    assert_eq!(client.get_transaction(&id).status, TxStatus::Pending);
}

// ── Batch execution (issue #1559) ────────────────────────────────────────────

#[test]
fn test_execute_batch_executes_ready_in_order() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id0 = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let id1 = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    client.confirm_transaction(&a, &id0);
    client.confirm_transaction(&a, &id1);

    let mut ids = Vec::new(&env);
    ids.push_back(id0);
    ids.push_back(id1);
    let executed = client.execute_batch(&a, &ids);
    assert_eq!(executed.len(), 2);
    assert_eq!(executed.get_unchecked(0), id0);
    assert_eq!(executed.get_unchecked(1), id1);
    assert_eq!(client.get_transaction(&id0).status, TxStatus::Executed);
    assert_eq!(client.get_transaction(&id1).status, TxStatus::Executed);
}

#[test]
fn test_execute_batch_is_all_or_nothing() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id0 = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let id1 = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    // Only the first becomes Ready.
    client.confirm_transaction(&a, &id0);

    let mut ids = Vec::new(&env);
    ids.push_back(id0);
    ids.push_back(id1);
    let result = client.try_execute_batch(&a, &ids);
    assert_eq!(result, Err(Ok(Error::WrongStatus)));
    // Nothing executed.
    assert_eq!(client.get_transaction(&id0).status, TxStatus::Ready);
    assert_eq!(client.get_transaction(&id1).status, TxStatus::Pending);
}

// ── Off-chain signature confirmations (issue #1559) ──────────────────────────

/// Deterministic test keypair plus its `BytesN<32>` public key.
fn test_keypair(env: &Env, seed_byte: u8) -> (SigningKey, BytesN<32>) {
    let signing = SigningKey::from_bytes(&[seed_byte; 32]);
    let verify_bytes = signing.verifying_key().to_bytes();
    (signing, BytesN::from_array(env, &verify_bytes))
}

/// The exact payload the contract verifies: b"MSIG1" || pubkey || tx_be || nonce_be.
fn signature_message(pubkey: &[u8; 32], tx_id: u32, nonce: u64) -> std::vec::Vec<u8> {
    let mut msg = std::vec::Vec::new();
    msg.extend_from_slice(b"MSIG1");
    msg.extend_from_slice(pubkey);
    msg.extend_from_slice(&tx_id.to_be_bytes());
    msg.extend_from_slice(&nonce.to_be_bytes());
    msg
}

#[test]
fn test_confirm_with_signature_ok_and_consumes_nonce() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    assert_eq!(client.get_owner_nonce(&a), 0);

    let (signing, pubkey) = test_keypair(&env, 7);
    client.set_owner_pubkey(&a, &a, &pubkey);

    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let sig = signing.sign(&signature_message(&pubkey.to_array(), id, 0));
    client.confirm_with_signature(&a, &id, &0, &BytesN::from_array(&env, &sig.to_bytes()));

    let tx = client.get_transaction(&id);
    assert_eq!(tx.status, TxStatus::Ready);
    assert_eq!(client.get_owner_nonce(&a), 1);
}

#[test]
fn test_confirm_with_signature_replay_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 2, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let (signing, pubkey) = test_keypair(&env, 7);
    client.set_owner_pubkey(&a, &a, &pubkey);

    let target = Address::generate(&env);
    let id0 = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let sig = signing.sign(&signature_message(&pubkey.to_array(), id0, 0));
    let sig_bytes = BytesN::from_array(&env, &sig.to_bytes());
    client.confirm_with_signature(&a, &id0, &0, &sig_bytes);

    // Same signature with the consumed nonce on another tx must fail.
    let id1 = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let result = client.try_confirm_with_signature(&a, &id1, &0, &sig_bytes);
    assert_eq!(result, Err(Ok(Error::InvalidNonce)));
}

#[test]
fn test_confirm_with_signature_bad_signature_traps() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let (signing, pubkey) = test_keypair(&env, 7);
    client.set_owner_pubkey(&a, &a, &pubkey);

    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    // Signed over a different tx id: verification must fail.
    let bad = signing.sign(&signature_message(&pubkey.to_array(), id + 99, 0));
    let result =
        client.try_confirm_with_signature(&a, &id, &0, &BytesN::from_array(&env, &bad.to_bytes()));
    assert!(result.is_err());
}

#[test]
fn test_confirm_with_signature_missing_pubkey_fails() {
    let env = make_env();
    let (client, owners) = init(&env, 1, 1, 0, 0);
    let a = owners.get_unchecked(0);
    let target = Address::generate(&env);
    let id = client.submit_transaction(&a, &target, &0, &str5(&env), &0);
    let result =
        client.try_confirm_with_signature(&a, &id, &0, &BytesN::from_array(&env, &[0u8; 64]));
    assert_eq!(result, Err(Ok(Error::MissingPubkey)));
}
