// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Transaction};

// ── Initialisation guard ──────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&InstanceKey::Initialized, &true);
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

// ── Delays ────────────────────────────────────────────────────────────────────

pub fn set_min_delay(env: &Env, d: u64) {
    env.storage().instance().set(&InstanceKey::MinDelay, &d);
}

pub fn get_min_delay(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::MinDelay)
        .unwrap_or(0)
}

pub fn set_max_delay(env: &Env, d: u64) {
    env.storage().instance().set(&InstanceKey::MaxDelay, &d);
}

pub fn get_max_delay(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::MaxDelay)
        .unwrap_or(0)
}

// ── Owners ────────────────────────────────────────────────────────────────────

pub fn get_owner_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::OwnerCount)
        .unwrap_or(0)
}

pub fn set_owner_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::OwnerCount, &count);
}

pub fn get_owner_at(env: &Env, idx: u32) -> Option<Address> {
    env.storage().persistent().get(&DataKey::OwnerAt(idx))
}

pub fn set_owner_at(env: &Env, idx: u32, owner: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::OwnerAt(idx), owner);
}

pub fn remove_owner_at(env: &Env, idx: u32) {
    env.storage().persistent().remove(&DataKey::OwnerAt(idx));
}

pub fn has_owner(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::IsOwner(addr.clone()))
}

pub fn set_is_owner(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::IsOwner(addr.clone()), &true);
}

pub fn remove_is_owner(env: &Env, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::IsOwner(addr.clone()));
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

// ── Confirmations ─────────────────────────────────────────────────────────────

pub fn is_confirmed(env: &Env, tx_id: u32, owner: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Confirmation(tx_id, owner.clone()))
}

pub fn record_confirmation(env: &Env, tx_id: u32, owner: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Confirmation(tx_id, owner.clone()), &true);
}

pub fn remove_confirmation(env: &Env, tx_id: u32, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Confirmation(tx_id, owner.clone()));
}

// ── Owner weights, pubkeys & nonces ─────────────────────────────────────────

/// Voting weight of an owner. Defaults to 1 so wallets configured before
/// weights existed behave exactly as before.
pub fn get_owner_weight(env: &Env, owner: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::OwnerWeight(owner.clone()))
        .unwrap_or(1)
}

pub fn set_owner_weight(env: &Env, owner: &Address, weight: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::OwnerWeight(owner.clone()), &weight);
}

pub fn remove_owner_weight(env: &Env, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::OwnerWeight(owner.clone()));
}

pub fn get_owner_pubkey(env: &Env, owner: &Address) -> Option<soroban_sdk::BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::OwnerPubkey(owner.clone()))
}

pub fn set_owner_pubkey(env: &Env, owner: &Address, pubkey: &soroban_sdk::BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::OwnerPubkey(owner.clone()), pubkey);
}

pub fn remove_owner_pubkey(env: &Env, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::OwnerPubkey(owner.clone()));
}

/// Monotonic nonce consumed by off-chain signature confirmations.
pub fn get_owner_nonce(env: &Env, owner: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::OwnerNonce(owner.clone()))
        .unwrap_or(0)
}

pub fn set_owner_nonce(env: &Env, owner: &Address, nonce: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::OwnerNonce(owner.clone()), &nonce);
}

pub fn remove_owner_nonce(env: &Env, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::OwnerNonce(owner.clone()));
}
