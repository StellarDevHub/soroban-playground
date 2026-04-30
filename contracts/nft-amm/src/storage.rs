// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Pool};

// ── Init guard ────────────────────────────────────────────────────────────────

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

// ── Pause ─────────────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

// ── Pool count ────────────────────────────────────────────────────────────────

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

// ── Protocol fee ──────────────────────────────────────────────────────────────

pub fn get_protocol_fee_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::ProtocolFeeBps)
        .unwrap_or(50) // default 0.5%
}

pub fn set_protocol_fee_bps(env: &Env, bps: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::ProtocolFeeBps, &bps);
}

pub fn get_protocol_fee_balance(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::ProtocolFeeBalance)
        .unwrap_or(0)
}

pub fn set_protocol_fee_balance(env: &Env, balance: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::ProtocolFeeBalance, &balance);
}

// ── Pools ─────────────────────────────────────────────────────────────────────

pub fn set_pool(env: &Env, pool: &Pool) {
    env.storage()
        .persistent()
        .set(&DataKey::Pool(pool.id), pool);
}

pub fn get_pool(env: &Env, id: u32) -> Result<Pool, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Pool(id))
        .ok_or(Error::PoolNotFound)
}

// ── Pool NFT slots ────────────────────────────────────────────────────────────

/// Store an NFT ID at a specific slot in the pool.
pub fn set_pool_nft(env: &Env, pool_id: u32, slot: u32, nft_id: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::PoolNft(pool_id, slot), &nft_id);
}

/// Get the NFT ID at a specific slot.
pub fn get_pool_nft(env: &Env, pool_id: u32, slot: u32) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::PoolNft(pool_id, slot))
}

/// Remove an NFT slot.
pub fn remove_pool_nft(env: &Env, pool_id: u32, slot: u32) {
    env.storage()
        .persistent()
        .remove(&DataKey::PoolNft(pool_id, slot));
}
