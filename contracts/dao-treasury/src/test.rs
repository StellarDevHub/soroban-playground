// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use crate::types::{Error, Role, TxStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Set up a treasury with owner + admin + operator (threshold = 1).
fn setup() -> (Env, Address, Address, Address, DaoTreasuryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, DaoTreasury);
    let client = DaoTreasuryClient::new(&env, &id);

    let owner = Address::generate(&env);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    client.initialize(&owner, &1);
    client.add_signer(&owner, &admin, &Role::Admin);
    client.add_signer(&owner, &operator, &Role::Operator);

    (env, owner, admin, operator, client)
}

fn desc(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn advance(env: &Env, secs: u64) {
    env.ledger().with_mut(|l| l.timestamp += secs);
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, DaoTreasury);
    let client = DaoTreasuryClient::new(&env, &id);
    let owner = Address::generate(&env);

    client.initialize(&owner, &1);
    assert_eq!(client.get_threshold(), 1);
    assert_eq!(client.get_signer_count(), 1);
}

#[test]
fn test_double_initialize_fails() {
    let (_env, owner, _admin, _op, client) = setup();
    let result = client.try_initialize(&owner, &1);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_zero_threshold_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, DaoTreasury);
    let client = DaoTreasuryClient::new(&env, &id);
    let owner = Address::generate(&env);

    let result = client.try_initialize(&owner, &0);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

// ── Pause / Unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_and_unpause() {
    let (_env, owner, _admin, _op, client) = setup();
    assert!(!client.is_paused());
    client.pause(&owner);
    assert!(client.is_paused());
    client.unpause(&owner);
    assert!(!client.is_paused());
}

#[test]
fn test_pause_prevents_propose() {
    let (env, owner, _admin, _op, client) = setup();
    client.pause(&owner);
    let result = client.try_propose(&owner, &desc(&env, "test"), &0, &None);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_pause_prevents_approve() {
    let (env, owner, _admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "test"), &0, &None);
    client.pause(&owner);
    let result = client.try_approve(&owner, &tx_id);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_operator_cannot_pause() {
    let (_env, _owner, _admin, operator, client) = setup();
    let result = client.try_pause(&operator);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Signer management ─────────────────────────────────────────────────────────

#[test]
fn test_add_and_remove_signer() {
    let (env, owner, _admin, _op, client) = setup();
    let new_signer = Address::generate(&env);

    client.add_signer(&owner, &new_signer, &Role::Viewer);
    assert_eq!(client.get_signer_count(), 4);

    // Lower threshold so removal is valid.
    client.change_threshold(&owner, &1);
    client.remove_signer(&owner, &new_signer);
    assert_eq!(client.get_signer_count(), 3);
}

#[test]
fn test_remove_signer_below_threshold_fails() {
    let (_env, owner, admin, _op, client) = setup();
    // threshold=1, count=3 → removing one leaves 2 ≥ 1, so this should succeed.
    // Raise threshold to 3 first to trigger the guard.
    client.change_threshold(&owner, &3);
    let result = client.try_remove_signer(&owner, &admin);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn test_add_duplicate_signer_fails() {
    let (_env, owner, admin, _op, client) = setup();
    let result = client.try_add_signer(&owner, &admin, &Role::Viewer);
    assert_eq!(result, Err(Ok(Error::SignerAlreadyExists)));
}

#[test]
fn test_operator_cannot_add_signer() {
    let (env, _owner, _admin, operator, client) = setup();
    let new_signer = Address::generate(&env);
    let result = client.try_add_signer(&operator, &new_signer, &Role::Viewer);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_change_threshold() {
    let (_env, owner, _admin, _op, client) = setup();
    client.change_threshold(&owner, &2);
    assert_eq!(client.get_threshold(), 2);
}

#[test]
fn test_change_threshold_above_signer_count_fails() {
    let (_env, owner, _admin, _op, client) = setup();
    // Only 3 signers; threshold of 4 is invalid.
    let result = client.try_change_threshold(&owner, &4);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

// ── Transaction lifecycle ─────────────────────────────────────────────────────

#[test]
fn test_propose_ok() {
    let (env, _owner, _admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Pay vendor"), &500, &None);
    assert_eq!(tx_id, 0);
    assert_eq!(client.get_tx_count(), 1);

    let tx = client.get_transaction(&tx_id);
    assert_eq!(tx.status, TxStatus::Pending);
    assert_eq!(tx.approvals, 0);
}

#[test]
fn test_propose_empty_description_fails() {
    let (env, _owner, _admin, operator, client) = setup();
    let result = client.try_propose(&operator, &desc(&env, ""), &0, &None);
    assert_eq!(result, Err(Ok(Error::EmptyDescription)));
}

#[test]
fn test_viewer_cannot_propose() {
    let (env, owner, _admin, _op, client) = setup();
    let viewer = Address::generate(&env);
    client.add_signer(&owner, &viewer, &Role::Viewer);
    let result = client.try_propose(&viewer, &desc(&env, "test"), &0, &None);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_approve_reaches_threshold_queued() {
    let (env, owner, _admin, operator, client) = setup();
    // threshold = 1, so a single approval queues the tx.
    let tx_id = client.propose(&operator, &desc(&env, "Pay"), &100, &None);
    client.approve(&owner, &tx_id);

    let tx = client.get_transaction(&tx_id);
    assert_eq!(tx.status, TxStatus::Queued);
    assert_eq!(tx.approvals, 1);
}

#[test]
fn test_approve_multi_threshold() {
    let (env, owner, admin, operator, client) = setup();
    client.change_threshold(&owner, &2);

    let tx_id = client.propose(&operator, &desc(&env, "Multi-sig"), &0, &None);
    client.approve(&owner, &tx_id);
    // Still pending after 1 of 2.
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Pending);

    client.approve(&admin, &tx_id);
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Queued);
}

#[test]
fn test_duplicate_approval_fails() {
    let (env, owner, _admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Dup"), &0, &None);
    client.approve(&owner, &tx_id);
    let result = client.try_approve(&owner, &tx_id);
    assert_eq!(result, Err(Ok(Error::AlreadyApproved)));
}

#[test]
fn test_approve_expired_tx_fails() {
    let (env, owner, _admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Expire"), &0, &None);
    // Advance past expiry (7 days).
    advance(&env, 604_801);
    let result = client.try_approve(&owner, &tx_id);
    assert_eq!(result, Err(Ok(Error::TransactionExpired)));
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Expired);
}

#[test]
fn test_execute_after_timelock() {
    let (env, owner, admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Execute"), &0, &None);
    client.approve(&owner, &tx_id);

    // Advance past the 24-hour timelock.
    advance(&env, 86_401);
    client.execute(&admin, &tx_id, &None);
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Executed);
}

#[test]
fn test_execute_before_timelock_fails() {
    let (env, owner, admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Too early"), &0, &None);
    client.approve(&owner, &tx_id);

    // Do NOT advance time.
    let result = client.try_execute(&admin, &tx_id, &None);
    assert_eq!(result, Err(Ok(Error::TimelockActive)));
}

#[test]
fn test_execute_expired_tx_fails() {
    let (env, owner, admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Expire exec"), &0, &None);
    client.approve(&owner, &tx_id);

    // Advance past expiry.
    advance(&env, 604_801);
    let result = client.try_execute(&admin, &tx_id, &None);
    assert_eq!(result, Err(Ok(Error::TransactionExpired)));
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Expired);
}

#[test]
fn test_execute_not_queued_fails() {
    let (env, _owner, admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Not queued"), &0, &None);
    // No approval → still Pending.
    advance(&env, 86_401);
    let result = client.try_execute(&admin, &tx_id, &None);
    assert_eq!(result, Err(Ok(Error::TransactionNotQueued)));
}

#[test]
fn test_cancel_pending_tx() {
    let (env, _owner, admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Cancel me"), &0, &None);
    client.cancel(&admin, &tx_id);
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Cancelled);
}

#[test]
fn test_cancel_queued_tx() {
    let (env, owner, admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Cancel queued"), &0, &None);
    client.approve(&owner, &tx_id);
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Queued);

    client.cancel(&admin, &tx_id);
    assert_eq!(client.get_transaction(&tx_id).status, TxStatus::Cancelled);
}

#[test]
fn test_cancel_executed_tx_fails() {
    let (env, owner, admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Already done"), &0, &None);
    client.approve(&owner, &tx_id);
    advance(&env, 86_401);
    client.execute(&admin, &tx_id, &None);

    let result = client.try_cancel(&admin, &tx_id);
    assert_eq!(result, Err(Ok(Error::TransactionNotPending)));
}

#[test]
fn test_operator_cannot_cancel() {
    let (env, _owner, _admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Op cancel"), &0, &None);
    let result = client.try_cancel(&operator, &tx_id);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── has_approved query ────────────────────────────────────────────────────────

#[test]
fn test_has_approved_query() {
    let (env, owner, _admin, operator, client) = setup();
    let tx_id = client.propose(&operator, &desc(&env, "Query"), &0, &None);
    assert!(!client.has_approved(&tx_id, &owner));
    client.approve(&owner, &tx_id);
    assert!(client.has_approved(&tx_id, &owner));
}

// ── Non-existent transaction ──────────────────────────────────────────────────

#[test]
fn test_get_nonexistent_tx_fails() {
    let (_env, _owner, _admin, _op, client) = setup();
    let result = client.try_get_transaction(&999);
    assert_eq!(result, Err(Ok(Error::TransactionNotFound)));
}
