// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{AggregationStrategy, DataKey, Error, InstanceKey, PriceSource};

// ── Instance (config) ─────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}
pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}
pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::Admin).ok_or(Error::NotInitialized)
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&InstanceKey::Paused).unwrap_or(false)
}
pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &v);
}

pub fn get_source_count(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::SourceCount).unwrap_or(0)
}
pub fn set_source_count(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::SourceCount, &v);
}

pub fn get_decimals(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::Decimals).unwrap_or(7)
}
pub fn set_decimals(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::Decimals, &v);
}

pub fn get_max_price_age(env: &Env) -> u64 {
    env.storage().instance().get(&InstanceKey::MaxPriceAge).unwrap_or(3600)
}
pub fn set_max_price_age(env: &Env, v: u64) {
    env.storage().instance().set(&InstanceKey::MaxPriceAge, &v);
}

pub fn get_outlier_bps(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::OutlierBps).unwrap_or(2000)
}
pub fn set_outlier_bps(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::OutlierBps, &v);
}

pub fn get_strategy(env: &Env) -> AggregationStrategy {
    env.storage()
        .instance()
        .get(&InstanceKey::Strategy)
        .unwrap_or(AggregationStrategy::Median)
}
pub fn set_strategy(env: &Env, v: AggregationStrategy) {
    env.storage().instance().set(&InstanceKey::Strategy, &v);
}

pub fn get_trim_pct(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::TrimPct).unwrap_or(10)
}
pub fn set_trim_pct(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::TrimPct, &v);
}

pub fn get_circuit_breaker_bps(env: &Env) -> u32 {
    // Default: 3000 bps = 30% max single-update swing
    env.storage().instance().get(&InstanceKey::CircuitBreakerBps).unwrap_or(3000)
}
pub fn set_circuit_breaker_bps(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::CircuitBreakerBps, &v);
}

// ── Persistent (source data) ──────────────────────────────────────────────────

pub fn set_source(env: &Env, id: u32, s: &PriceSource) {
    env.storage().persistent().set(&DataKey::Source(id), s);
}
pub fn get_source(env: &Env, id: u32) -> Result<PriceSource, Error> {
    env.storage().persistent().get(&DataKey::Source(id)).ok_or(Error::SourceNotFound)
}
