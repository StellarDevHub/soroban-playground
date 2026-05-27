// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use crate::types::{DataKey, Error, Role, Signer, Transaction};
use soroban_sdk::{Address, Env};

// ── Initialization ────────────────────────────────────────────────────────────

/// Returns `true` if the contract has been initialized (admin key is present).
pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Threshold ─────────────────────────────────────────────────────────────────

pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Threshold)
        .unwrap_or(1)
}

pub fn set_threshold(env: &Env, threshold: u32) {
    env.storage().instance().set(&DataKey::Threshold, &threshold);
}

// ── Signer count ──────────────────────────────────────────────────────────────

pub fn get_signer_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SignerCount)
        .unwrap_or(0)
}

pub fn set_signer_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::SignerCount, &count);
}

// ── Signers ───────────────────────────────────────────────────────────────────

pub fn has_signer(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Signer(addr.clone()))
}

pub fn get_signer(env: &Env, addr: &Address) -> Result<Signer, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Signer(addr.clone()))
        .ok_or(Error::SignerNotFound)
}

pub fn set_signer(env: &Env, signer: &Signer) {
    env.storage()
        .persistent()
        .set(&DataKey::Signer(signer.address.clone()), signer);
}

pub fn remove_signer(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Signer(addr.clone()));
}

/// Returns the role of `addr`, or `Error::SignerNotFound` if not a signer.
pub fn role_of(env: &Env, addr: &Address) -> Result<Role, Error> {
    Ok(get_signer(env, addr)?.role)
}

// ── Transactions ──────────────────────────────────────────────────────────────

pub fn get_tx_count(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::TxCount).unwrap_or(0)
}

pub fn set_tx_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::TxCount, &count);
}

/// Fetch a transaction by ID. Returns `Error::TransactionNotFound` if absent.
pub fn get_tx(env: &Env, id: u32) -> Result<Transaction, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Tx(id))
        .ok_or(Error::TransactionNotFound)
}

pub fn set_tx(env: &Env, tx: &Transaction) {
    env.storage().persistent().set(&DataKey::Tx(tx.id), tx);
}

// ── Approvals ─────────────────────────────────────────────────────────────────

pub fn has_approved(env: &Env, tx_id: u32, signer: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Approval(tx_id, signer.clone()))
}

pub fn record_approval(env: &Env, tx_id: u32, signer: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Approval(tx_id, signer.clone()), &true);
}

// ── Pause state ───────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::IsPaused, &paused);
}
