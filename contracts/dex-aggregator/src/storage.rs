// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Pool};

// ── Admin ────────────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ── Pool counter ──────────────────────────────────────────────────────────────

pub fn get_pool_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::PoolCount)
        .unwrap_or(0)
}

pub fn set_pool_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::PoolCount, &count);
}

// ── Max hops ──────────────────────────────────────────────────────────────────

pub fn get_max_hops(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::MaxHops)
        .unwrap_or(3)
}

pub fn set_max_hops(env: &Env, max: u32) {
    env.storage().instance().set(&InstanceKey::MaxHops, &max);
}

// ── Protocol fee ──────────────────────────────────────────────────────────────

pub fn get_protocol_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::ProtocolFeeBps)
        .unwrap_or(0)
}

pub fn set_protocol_fee_bps(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::ProtocolFeeBps, &bps);
}

pub fn get_protocol_fee_accrued(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::ProtocolFeeAccrued)
        .unwrap_or(0)
}

pub fn add_protocol_fee(env: &Env, amount: i128) {
    let current = get_protocol_fee_accrued(env);
    env.storage()
        .instance()
        .set(&InstanceKey::ProtocolFeeAccrued, &(current + amount));
}

// ── Pool ──────────────────────────────────────────────────────────────────────

pub fn set_pool(env: &Env, id: u32, pool: &Pool) {
    env.storage().persistent().set(&DataKey::Pool(id), pool);
}

pub fn get_pool(env: &Env, id: u32) -> Result<Pool, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Pool(id))
        .ok_or(Error::PoolNotFound)
}

pub fn has_pool(env: &Env, id: u32) -> bool {
    env.storage().persistent().has(&DataKey::Pool(id))
}

// ── User volume ───────────────────────────────────────────────────────────────

pub fn add_user_volume(env: &Env, user: &Address, amount: i128) {
    let key = DataKey::UserVolume(user.clone());
    let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
    env.storage()
        .persistent()
        .set(&key, &current.saturating_add(amount));
}

pub fn get_user_volume(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserVolume(user.clone()))
        .unwrap_or(0)
}
