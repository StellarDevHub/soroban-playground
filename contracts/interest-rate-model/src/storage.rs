// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, Vec};

use crate::types::{DataKey, InterestRateConfig, RateSnapshot, RateTier};

// ── Initialization & Admin ─────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Configuration ──────────────────────────────────────────────────────────

pub fn get_config(env: &Env) -> Option<InterestRateConfig> {
    env.storage().instance().get(&DataKey::Config)
}

pub fn set_config(env: &Env, config: &InterestRateConfig) {
    env.storage().instance().set(&DataKey::Config, config);
}

// ── Tiers (for tiered rate models) ─────────────────────────────────────────

pub fn get_tier_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::TierCount)
        .unwrap_or(0)
}

pub fn set_tier_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::TierCount, &count);
}

pub fn get_tier(env: &Env, index: u32) -> Option<RateTier> {
    let key = DataKey::Tiers;
    let tiers: Vec<RateTier> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    if (index as usize) < tiers.len() {
        tiers.get(index as usize)
    } else {
        None
    }
}

pub fn set_tiers(env: &Env, tiers: &Vec<RateTier>) {
    env.storage().instance().set(&DataKey::Tiers, tiers);
    env.storage()
        .instance()
        .set(&DataKey::TierCount, &(tiers.len() as u32));
}

// ── History ────────────────────────────────────────────────────────────────

pub fn get_history_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::HistoryIndex)
        .unwrap_or(0)
}

pub fn add_snapshot(env: &Env, snapshot: &RateSnapshot) -> u32 {
    let count = get_history_count(env);
    let new_id = count + 1;
    env.storage()
        .instance()
        .set(&DataKey::HistorySnapshot(new_id), snapshot);
    env.storage()
        .instance()
        .set(&DataKey::HistoryIndex, &new_id);
    new_id
}

pub fn get_snapshot(env: &Env, snapshot_id: u32) -> Option<RateSnapshot> {
    env.storage()
        .instance()
        .get(&DataKey::HistorySnapshot(snapshot_id))
}

pub fn get_last_update(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::LastUpdate)
        .unwrap_or(0)
}

pub fn set_last_update(env: &Env, timestamp: u64) {
    env.storage()
        .instance()
        .set(&DataKey::LastUpdate, &timestamp);
}
