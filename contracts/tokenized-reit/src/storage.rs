// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, Holding, InstanceKey, ReitTrust};

const LEDGER_TTL: u32 = 518400; // ~30 days

// ── Instance storage ──────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
    env.storage().instance().extend_ttl(LEDGER_TTL, LEDGER_TTL);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_trust_count(env: &Env, count: u32) {
    env.storage().instance().set(&InstanceKey::TrustCount, &count);
}

pub fn get_trust_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::TrustCount)
        .unwrap_or(0)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

// ── Persistent storage ────────────────────────────────────────────────────────

pub fn set_trust(env: &Env, id: u32, trust: &ReitTrust) {
    env.storage().persistent().set(&DataKey::Trust(id), trust);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::Trust(id), LEDGER_TTL, LEDGER_TTL);
}

pub fn get_trust(env: &Env, id: u32) -> Result<ReitTrust, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Trust(id))
        .ok_or(Error::TrustNotFound)
}

pub fn set_holding(env: &Env, trust_id: u32, investor: &Address, holding: &Holding) {
    let key = DataKey::Holding(trust_id, investor.clone());
    env.storage().persistent().set(&key, holding);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_TTL, LEDGER_TTL);
}

pub fn get_holding(env: &Env, trust_id: u32, investor: &Address) -> Result<Holding, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Holding(trust_id, investor.clone()))
        .ok_or(Error::NoShares)
}

pub fn has_holding(env: &Env, trust_id: u32, investor: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Holding(trust_id, investor.clone()))
}

pub fn remove_holding(env: &Env, trust_id: u32, investor: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Holding(trust_id, investor.clone()));
}
