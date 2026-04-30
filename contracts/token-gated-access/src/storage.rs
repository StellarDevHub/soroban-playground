// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{Analytics, DataKey, Error, InstanceKey, Membership};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &v);
}

pub fn next_token_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&InstanceKey::NextTokenId)
        .unwrap_or(1u64);
    env.storage()
        .instance()
        .set(&InstanceKey::NextTokenId, &(id + 1));
    id
}

// ── Membership ────────────────────────────────────────────────────────────────

pub fn set_membership(env: &Env, m: &Membership) {
    env.storage()
        .persistent()
        .set(&DataKey::Membership(m.token_id), m);
    env.storage()
        .persistent()
        .set(&DataKey::OwnerToken(m.owner.clone()), &m.token_id);
}

pub fn get_membership_by_token(env: &Env, token_id: u64) -> Result<Membership, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Membership(token_id))
        .ok_or(Error::TokenNotFound)
}

pub fn get_token_id_for_owner(env: &Env, owner: &Address) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::OwnerToken(owner.clone()))
}

pub fn remove_membership(env: &Env, token_id: u64, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Membership(token_id));
    env.storage()
        .persistent()
        .remove(&DataKey::OwnerToken(owner.clone()));
}

// ── Analytics ─────────────────────────────────────────────────────────────────

pub fn get_analytics(env: &Env) -> Analytics {
    env.storage()
        .instance()
        .get(&InstanceKey::Analytics)
        .unwrap_or(Analytics {
            total_members: 0,
            basic_count: 0,
            premium_count: 0,
            elite_count: 0,
            total_access_checks: 0,
            last_updated: 0,
        })
}

pub fn set_analytics(env: &Env, a: &Analytics) {
    env.storage().instance().set(&InstanceKey::Analytics, a);
}

pub fn increment_access_count(env: &Env, addr: &Address) {
    let count: u64 = env
        .storage()
        .persistent()
        .get(&DataKey::AccessCount(addr.clone()))
        .unwrap_or(0);
    env.storage()
        .persistent()
        .set(&DataKey::AccessCount(addr.clone()), &(count + 1));
}

pub fn get_access_count(env: &Env, addr: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::AccessCount(addr.clone()))
        .unwrap_or(0)
}
