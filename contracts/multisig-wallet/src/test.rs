// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Env, String,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup_3of5() -> (Env, Address, Address, Address, MultisigWalletClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MultisigWallet);
    let client = MultisigWalletClient::new(&env, &id);

    let owner = Address::generate(&env);
    let admin = Address::generate(&env);
    let operator = Address::generate(&env);

    client.initialize(&owner, &3, &None);
    client.add_signer(&owner, &admin, &Role::Admin);
    client.add_signer(&owner, &operator, &Role::Operator);

    (env, owner, admin, operator, client)
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MultisigWallet);
    let client = MultisigWalletClient::new(&env, &id);
    let owner = Address::generate(&env);

    client.initialize(&owner, &2, &None);
    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_signer_count(), 1);
}

#[test]
fn test_double_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, MultisigWallet);
    let client = MultisigWalletClient::new(&env, &id);
    let owner = Address::generate(&env);

    client.initialize(&owner, &1, &None);
    let result = client.try_initialize(&owner, &1, &None);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Signer management ─────────────────────────────────────────────────────────

#[test]
fn test_add_remove_signer() {
    let (env, owner, _admin, _op, client) = setup_3of5();
    let new_signer = Address::generate(&env);

    client.add_signer(&owner, &new_signer, &Role::Viewer);
    assert_eq!(client.get_signer_count(), 4);

    // Adjust threshold so removal is valid (3 of 4 → 3 of 3 is fine).
    client.remove_signer(&owner, &new_signer);
    assert_eq!(client.get_signer_count(), 3);
}

#[test]
fn test_remove_signer_below_threshold_fails() {
    let (_env, owner, _admin, _op, client) = setup_3of5();
    // Only 3 signers, threshold is 3 — removing any would break it.
    let result = client.try_remove_signer(&owner, &_admin);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn test_change_threshold() {
    let (_env, owner, _admin, _op, client) = setup_3of5();
    client.change_threshold(&owner, &2);
    assert_eq!(client.get_threshold(), 2);
}

// ── Transaction lifecycle ─────────────────────────────────────────────────────

#[test]
fn test_propose_and_approve_reaches_queued() {
    let (env, owner, admin, operator, client) = setup_3of5();
    let desc = String::from_str(&env, "Send 100 XLM to treasury");

    let tx_id = client.propose(&operator, &desc, &100_000_000, &None);
    assert_eq!(tx_id, 0);

    // Need 3 approvals; owner + admin + operator = 3.
    client.approve(&owner, &tx_id);
    client.approve(&admin, &tx_id);
    client.approve(&operator, &tx_id);

    let tx = client.get_transaction(&tx_id);
    assert_eq!(tx.status, TxStatus::Queued);
    assert_eq!(tx.approvals, 3);
}

#[test]
fn test_duplicate_approval_fails() {
    let (env, owner, _admin, operator, client) = setup_3of5();
    let desc = String::from_str(&env, "Duplicate test");
    let tx_id = client.propose(&operator, &desc, &0, &None);

    client.approve(&owner, &tx_id);
    let result = client.try_approve(&owner, &tx_id);
    assert_eq!(result, Err(Ok(Error::AlreadyApproved)));
}

#[test]
fn test_execute_after_timelock() {
    let (env, owner, admin, operator, client) = setup_3of5();
    let desc = String::from_str(&env, "Execute after timelock");
    let tx_id = client.propose(&operator, &desc, &0, &None);

    client.approve(&owner, &tx_id);
    client.approve(&admin, &tx_id);
    client.approve(&operator, &tx_id);

    // Advance ledger past the 24-hour timelock.
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    client.execute(&admin, &tx_id);
    let tx = client.get_transaction(&tx_id);
    assert_eq!(tx.status, TxStatus::Executed);
}

#[test]
fn test_execute_before_timelock_fails() {
    let (env, owner, admin, operator, client) = setup_3of5();
    let desc = String::from_str(&env, "Too early");
    let tx_id = client.propose(&operator, &desc, &0, &None);

    client.approve(&owner, &tx_id);
    client.approve(&admin, &tx_id);
    client.approve(&operator, &tx_id);

    // Do NOT advance time — timelock still active.
    let result = client.try_execute(&admin, &tx_id);
    assert_eq!(result, Err(Ok(Error::TimelockActive)));
}

#[test]
fn test_cancel_transaction() {
    let (env, _owner, admin, operator, client) = setup_3of5();
    let desc = String::from_str(&env, "Cancel me");
    let tx_id = client.propose(&operator, &desc, &0, &None);

    client.cancel(&admin, &tx_id);
    let tx = client.get_transaction(&tx_id);
    assert_eq!(tx.status, TxStatus::Cancelled);
}

#[test]
fn test_daily_limit_enforced() {
    let (env, owner, admin, operator, client) = setup_3of5();
    // Set a 50 XLM daily limit.
    client.set_daily_limit(&owner, &50_000_000);

    let desc = String::from_str(&env, "Over limit");
    let tx_id = client.propose(&operator, &desc, &60_000_000, &None);

    client.approve(&owner, &tx_id);
    client.approve(&admin, &tx_id);
    client.approve(&operator, &tx_id);

    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_execute(&admin, &tx_id);
    assert_eq!(result, Err(Ok(Error::DailyLimitExceeded)));
}

#[test]
fn test_unauthorized_role_cannot_add_signer() {
    let (env, _owner, _admin, operator, client) = setup_3of5();
    let new_signer = Address::generate(&env);
    // Operator (role < Admin) cannot add signers.
    let result = client.try_add_signer(&operator, &new_signer, &Role::Viewer);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}
