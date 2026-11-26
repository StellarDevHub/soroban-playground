// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String};

use crate::types::{DataKey, DataSource, Error, InstanceKey, WeatherData};

// ── Instance storage (admin / config) ─────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Initialized)
}
pub fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&InstanceKey::Initialized, &true);
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

pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::VerificationThreshold)
        .unwrap_or(2)
}
pub fn set_threshold(env: &Env, v: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::VerificationThreshold, &v);
}

pub fn get_record_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::RecordCount)
        .unwrap_or(0)
}
pub fn set_record_count(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::RecordCount, &v);
}

pub fn is_circuit_breaker_active(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::CircuitBreaker)
        .unwrap_or(false)
}
pub fn set_circuit_breaker(env: &Env, v: bool) {
    env.storage()
        .instance()
        .set(&InstanceKey::CircuitBreaker, &v);
}

// ── Persistent storage (data) ─────────────────────────────────────────────────

pub fn set_record(env: &Env, r: &WeatherData) {
    env.storage()
        .persistent()
        .set(&DataKey::WeatherData(r.id), r);
}
pub fn get_record(env: &Env, id: u32) -> Result<WeatherData, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::WeatherData(id))
        .ok_or(Error::RecordNotFound)
}

pub fn source_exists(env: &Env, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Source(addr.clone()))
}
pub fn set_source(env: &Env, s: &DataSource) {
    env.storage()
        .persistent()
        .set(&DataKey::Source(s.address.clone()), s);
}
pub fn get_source(env: &Env, addr: &Address) -> Result<DataSource, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Source(addr.clone()))
        .ok_or(Error::SourceNotFound)
}

pub fn has_submitted(env: &Env, record_id: u32, source: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Submitted(record_id, source.clone()))
}
pub fn mark_submitted(env: &Env, record_id: u32, source: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Submitted(record_id, source.clone()), &true);
}

pub fn set_history_index(env: &Env, location: &String, observed_at: u64, record_id: u32) {
    env.storage().persistent().set(
        &DataKey::HistoryIndex(location.clone(), observed_at),
        &record_id,
    );
}

pub fn get_epoch_reports(env: &Env, station_id: u32, epoch: u64) -> soroban_sdk::Vec<crate::types::EpochReport> {
    env.storage()
        .persistent()
        .get(&DataKey::EpochReports(station_id, epoch))
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

pub fn set_epoch_reports(env: &Env, station_id: u32, epoch: u64, reports: &soroban_sdk::Vec<crate::types::EpochReport>) {
    env.storage()
        .persistent()
        .set(&DataKey::EpochReports(station_id, epoch), reports);
}

pub fn set_epoch_consensus(env: &Env, station_id: u32, epoch: u64, consensus: &crate::types::EpochConsensus) {
    env.storage()
        .persistent()
        .set(&DataKey::EpochConsensus(station_id, epoch), consensus);
}

pub fn get_epoch_consensus(env: &Env, station_id: u32, epoch: u64) -> Result<crate::types::EpochConsensus, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::EpochConsensus(station_id, epoch))
        .ok_or(Error::ConsensusNotReached)
}
pub fn get_history_index(env: &Env, location: &String, observed_at: u64) -> Option<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::HistoryIndex(location.clone(), observed_at))
}
