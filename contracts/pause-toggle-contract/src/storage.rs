// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String, Vec};

use crate::types::{DataKey, Error, InstanceKey};

// ── Init / admin set ──────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admins)
}

pub fn set_admins(env: &Env, admins: &Vec<Address>) {
    env.storage().instance().set(&InstanceKey::Admins, admins);
}

pub fn get_admins(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admins)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn is_admin(env: &Env, addr: &Address) -> bool {
    get_admins(env).contains(addr)
}

pub fn set_admin_threshold(env: &Env, threshold: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::AdminThreshold, &threshold);
}

pub fn get_admin_threshold(env: &Env) -> Result<u32, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::AdminThreshold)
        .ok_or(Error::NotInitialized)
}

// ── Guardians ─────────────────────────────────────────────────────────────────

pub fn set_guardians(env: &Env, guardians: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&InstanceKey::Guardians, guardians);
}

pub fn get_guardians(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&InstanceKey::Guardians)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn is_guardian(env: &Env, addr: &Address) -> bool {
    get_guardians(env).contains(addr)
}

// ── Pause state ───────────────────────────────────────────────────────────────

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_pause_reason(env: &Env, reason: &String) {
    env.storage()
        .instance()
        .set(&InstanceKey::PauseReason, reason);
}

pub fn get_pause_reason(env: &Env) -> Option<String> {
    env.storage().instance().get(&InstanceKey::PauseReason)
}

pub fn clear_pause_reason(env: &Env) {
    env.storage().instance().remove(&InstanceKey::PauseReason);
}

pub fn set_pause_timestamp(env: &Env, timestamp: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::PauseTimestamp, &timestamp);
}

pub fn get_pause_timestamp(env: &Env) -> Option<u64> {
    env.storage().instance().get(&InstanceKey::PauseTimestamp)
}

pub fn clear_pause_timestamp(env: &Env) {
    env.storage()
        .instance()
        .remove(&InstanceKey::PauseTimestamp);
}

// ── Unpause schedule ──────────────────────────────────────────────────────────

pub fn set_unpause_eta(env: &Env, eta: u64) {
    env.storage().instance().set(&InstanceKey::UnpauseEta, &eta);
}

pub fn get_unpause_eta(env: &Env) -> Option<u64> {
    env.storage().instance().get(&InstanceKey::UnpauseEta)
}

pub fn clear_unpause_eta(env: &Env) {
    env.storage().instance().remove(&InstanceKey::UnpauseEta);
}

// ── Base collateral ───────────────────────────────────────────────────────────

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&InstanceKey::Token, token);
}

pub fn get_token(env: &Env) -> Option<Address> {
    env.storage().instance().get(&InstanceKey::Token)
}

pub fn set_balance(env: &Env, user: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(user.clone()), &amount);
}

pub fn get_balance(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(user.clone()))
        .unwrap_or(0)
}
