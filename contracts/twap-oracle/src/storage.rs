// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String, Vec};

use crate::types::{AssetConfig, DataKey, Error, InstanceKey, Observation};

// ── Admin ─────────────────────────────────────────────────────────────────────

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

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::IsPaused, &paused);
}

// ── Feeders ───────────────────────────────────────────────────────────────────

pub fn is_feeder(env: &Env, feeder: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Feeder(feeder.clone()))
        .unwrap_or(false)
}

pub fn set_feeder(env: &Env, feeder: &Address, active: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Feeder(feeder.clone()), &active);
}

// ── Assets ────────────────────────────────────────────────────────────────────

pub fn get_asset_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::AssetCount)
        .unwrap_or(0)
}

pub fn set_asset_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::AssetCount, &count);
}

pub fn get_asset(env: &Env, asset_id: u32) -> Result<AssetConfig, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Asset(asset_id))
        .ok_or(Error::AssetNotFound)
}

pub fn set_asset(env: &Env, asset_id: u32, config: &AssetConfig) {
    env.storage()
        .persistent()
        .set(&DataKey::Asset(asset_id), config);
}

pub fn get_asset_id_by_symbol(env: &Env, symbol: &String) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::AssetSymbol(symbol.clone()))
}

pub fn set_asset_symbol_index(env: &Env, symbol: &String, asset_id: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::AssetSymbol(symbol.clone()), &asset_id);
}

// ── Observations ──────────────────────────────────────────────────────────────

pub fn get_observations(env: &Env, asset_id: u32) -> Vec<Observation> {
    env.storage()
        .persistent()
        .get(&DataKey::Observations(asset_id))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_observations(env: &Env, asset_id: u32, obs: &Vec<Observation>) {
    env.storage()
        .persistent()
        .set(&DataKey::Observations(asset_id), obs);
}

/// Append an observation, keeping at most `max_obs` entries (drops oldest first).
pub fn push_observation(env: &Env, asset_id: u32, obs: Observation, max_obs: u32) {
    let mut all = get_observations(env, asset_id);
    if all.len() >= max_obs {
        // Shift out the oldest entry.
        let mut trimmed: Vec<Observation> = Vec::new(env);
        for i in 1..all.len() {
            trimmed.push_back(all.get(i).unwrap());
        }
        all = trimmed;
    }
    all.push_back(obs);
    set_observations(env, asset_id, &all);
}
