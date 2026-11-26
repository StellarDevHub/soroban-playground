// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String};

use crate::types::{
    AggregationStrategy, DataKey, Error, InstanceKey, PriceBounds, PriceEntry, Source,
};

// ── Instance (contract-global) ────────────────────────────────────────────────

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

pub fn get_source_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::SourceCount)
        .unwrap_or(0)
}
pub fn set_source_count(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::SourceCount, &v);
}

pub fn get_strategy(env: &Env) -> AggregationStrategy {
    env.storage()
        .instance()
        .get(&InstanceKey::Strategy)
        .unwrap_or(AggregationStrategy::Median)
}
pub fn set_strategy(env: &Env, s: AggregationStrategy) {
    env.storage().instance().set(&InstanceKey::Strategy, &s);
}

pub fn get_max_price_age(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::MaxPriceAge)
        .unwrap_or(3600u64)
        .min(3600)
}
pub fn set_max_price_age(env: &Env, v: u64) {
    env.storage().instance().set(&InstanceKey::MaxPriceAge, &v);
}

pub fn get_outlier_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::OutlierBps)
        .unwrap_or(2000)
}
pub fn set_outlier_bps(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::OutlierBps, &v);
}

pub fn get_circuit_breaker_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::CircuitBreakerBps)
        .unwrap_or(5000)
}
pub fn set_circuit_breaker_bps(env: &Env, v: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::CircuitBreakerBps, &v);
}

pub fn get_min_sources(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::MinSources)
        .unwrap_or(3u32)
        .max(3)
}
pub fn set_min_sources(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::MinSources, &v);
}

// ── Persistent ────────────────────────────────────────────────────────────────

pub fn set_source(env: &Env, s: &Source) {
    env.storage().persistent().set(&DataKey::Source(s.id), s);
}
pub fn get_source(env: &Env, id: u32) -> Result<Source, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Source(id))
        .ok_or(Error::SourceNotFound)
}

pub fn is_authorized(env: &Env, source_id: u32) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Authorized(source_id))
        .unwrap_or(false)
}
pub fn set_authorized(env: &Env, source_id: u32, v: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Authorized(source_id), &v);
}

pub fn set_price(env: &Env, source_id: u32, asset: &String, entry: &PriceEntry) {
    env.storage()
        .persistent()
        .set(&DataKey::VerifiedPrice(source_id, asset.clone()), entry);
}
pub fn get_price(env: &Env, source_id: u32, asset: &String) -> Option<PriceEntry> {
    env.storage()
        .persistent()
        .get(&DataKey::VerifiedPrice(source_id, asset.clone()))
}

pub fn set_last_aggregated(env: &Env, asset: &String, price: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::LastAggregated(asset.clone()), &price);
}
pub fn get_last_aggregated(env: &Env, asset: &String) -> Option<i128> {
    env.storage()
        .persistent()
        .get(&DataKey::LastAggregated(asset.clone()))
}

pub fn get_reporter(env: &Env, id: u32) -> Option<Address> {
    env.storage().persistent().get(&DataKey::Reporter(id))
}
pub fn set_reporter(env: &Env, id: u32, reporter: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Reporter(id), reporter);
}
pub fn get_price_bounds(env: &Env, asset: &String) -> Result<PriceBounds, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::PriceBounds(asset.clone()))
        .ok_or(Error::PriceBoundsNotSet)
}
pub fn set_price_bounds(env: &Env, asset: &String, bounds: &PriceBounds) {
    env.storage()
        .persistent()
        .set(&DataKey::PriceBounds(asset.clone()), bounds);
}
