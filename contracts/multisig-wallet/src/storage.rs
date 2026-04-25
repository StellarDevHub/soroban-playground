// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Role, Signer, Transaction};

// ── Initialisation guard ──────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ── Threshold ─────────────────────────────────────────────────────────────────

pub fn set_threshold(env: &Env, t: u32) {
    env.storage().instance().set(&InstanceKey::Threshold, &t);
}

pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::Threshold)
        .unwrap_or(1)
}

// ── Signer count ──────────────────────────────────────────────────────────────

pub fn get_signer_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::SignerCount)
        .unwrap_or(0)
}

pub fn set_signer_count(env: &Env, n: u32) {
    env.storage().instance().set(&InstanceKey::SignerCount, &n);
}

// ── Signers ───────────────────────────────────────────────────────────────────

pub fn set_signer(env: &Env, signer: &Signer) {
    env.storage()
        .persistent()
        .set(&DataKey::Signer(signer.address.clone()), signer);
}

pub fn get_signer(env: &Env, addr: &Address) -> Result<Signer, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Signer(addr.clone()))
        .ok_or(Error::SignerNotFound)
}

pub fn has_signer(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Signer(addr.clone()))
}

pub fn remove_signer(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Signer(addr.clone()));
}

// ── Transactions ──────────────────────────────────────────────────────────────

pub fn get_tx_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::TxCount)
        .unwrap_or(0)
}

pub fn set_tx_count(env: &Env, n: u32) {
    env.storage().instance().set(&InstanceKey::TxCount, &n);
}

pub fn set_tx(env: &Env, tx: &Transaction) {
    env.storage()
        .persistent()
        .set(&DataKey::Transaction(tx.id), tx);
}

pub fn get_tx(env: &Env, id: u32) -> Result<Transaction, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Transaction(id))
        .ok_or(Error::TransactionNotFound)
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

// ── Daily withdrawal limit ────────────────────────────────────────────────────

pub fn get_daily_limit(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::DailyLimit)
        .unwrap_or(i128::MAX)
}

pub fn set_daily_limit(env: &Env, limit: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::DailyLimit, &limit);
}

/// Returns (withdrawn_today, day_start_ts).
pub fn get_daily_state(env: &Env) -> (i128, u64) {
    let withdrawn: i128 = env
        .storage()
        .instance()
        .get(&InstanceKey::WithdrawnToday)
        .unwrap_or(0);
    let day_start: u64 = env
        .storage()
        .instance()
        .get(&InstanceKey::DayStart)
        .unwrap_or(0);
    (withdrawn, day_start)
}

pub fn set_daily_state(env: &Env, withdrawn: i128, day_start: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::WithdrawnToday, &withdrawn);
    env.storage()
        .instance()
        .set(&InstanceKey::DayStart, &day_start);
}

// ── Role helpers ──────────────────────────────────────────────────────────────

/// Returns the role of `addr`, or `Error::SignerNotFound`.
pub fn role_of(env: &Env, addr: &Address) -> Result<Role, Error> {
    Ok(get_signer(env, addr)?.role)
}
