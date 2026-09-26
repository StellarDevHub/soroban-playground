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
    env.storage()
        .instance()
        .set(&InstanceKey::IsPaused, &paused);
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
    if active {
        // Maintain the append-only feeder roster used for median computation.
        let mut list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::FeederList)
            .unwrap_or_else(|| Vec::new(env));
        let mut present = false;
        for known in list.iter() {
            if known == *feeder {
                present = true;
                break;
            }
        }
        if !present {
            list.push_back(feeder.clone());
            env.storage().persistent().set(&DataKey::FeederList, &list);
        }
    }
}

pub fn feeder_list(env: &Env) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::FeederList)
        .unwrap_or_else(|| Vec::new(env))
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

/// Default cross-feeder deviation tolerance: 500 bps (5%).
pub const DEFAULT_MAX_DEVIATION_BPS: u32 = 500;

/// Latest observation submitted by one feeder for one asset, if any.
pub fn get_latest_by_feeder(env: &Env, asset_id: u32, feeder: &Address) -> Option<Observation> {
    env.storage()
        .persistent()
        .get(&DataKey::LatestByFeeder(asset_id, feeder.clone()))
}

pub fn set_latest_by_feeder(env: &Env, asset_id: u32, feeder: &Address, obs: &Observation) {
    env.storage()
        .persistent()
        .set(&DataKey::LatestByFeeder(asset_id, feeder.clone()), obs);
}

/// Maximum accepted deviation from the cross-feeder median in basis points.
pub fn get_max_deviation_bps(env: &Env, asset_id: u32) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::MaxDeviation(asset_id))
        .unwrap_or(DEFAULT_MAX_DEVIATION_BPS)
}

pub fn set_max_deviation_bps(env: &Env, asset_id: u32, bps: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::MaxDeviation(asset_id), &bps);
}

/// Latest submitted price of every *active* feeder for an asset, optionally
/// excluding one feeder (the submitter under validation).
pub fn latest_prices_excluding(env: &Env, asset_id: u32, exclude: Option<&Address>) -> Vec<i128> {
    let mut prices: Vec<i128> = Vec::new(env);
    for feeder in feeder_list(env).iter() {
        if !is_feeder(env, &feeder) {
            continue;
        }
        if let Some(skip) = exclude {
            if feeder == *skip {
                continue;
            }
        }
        if let Some(obs) = get_latest_by_feeder(env, asset_id, &feeder) {
            prices.push_back(obs.price);
        }
    }
    prices
}

/// Median of a non-empty price list (lower middle for even counts).
pub fn median_price(prices: &Vec<i128>) -> Option<i128> {
    let n = prices.len();
    if n == 0 {
        return None;
    }
    // Insertion sort; feeder counts are small.
    let mut sorted: Vec<i128> = Vec::new(prices.env());
    for price in prices.iter() {
        let mut inserted = false;
        for i in 0..sorted.len() {
            if price < sorted.get(i).unwrap() {
                sorted.insert(i, price);
                inserted = true;
                break;
            }
        }
        if !inserted {
            sorted.push_back(price);
        }
    }
    Some(sorted.get((n - 1) / 2).unwrap())
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
