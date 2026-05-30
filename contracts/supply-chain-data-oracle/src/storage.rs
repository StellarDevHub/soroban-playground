// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataSource, Error, LogisticsData, ProvenanceRecord};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&soroban_sdk::symbol_short!("INIT"))
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("INIT"), &true);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("ADMIN"))
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("ADMIN"), admin);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("PAUSED"))
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("PAUSED"), &paused);
}

pub fn get_data_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("DCOUNT"))
        .unwrap_or(0u32)
}

pub fn set_data_count(env: &Env, count: u32) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("DCOUNT"), &count);
}

pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("THRESH"))
        .unwrap_or(2u32)
}

pub fn set_threshold(env: &Env, threshold: u32) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("THRESH"), &threshold);
}

pub fn is_circuit_breaker_active(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("CB"))
        .unwrap_or(false)
}

pub fn set_circuit_breaker(env: &Env, active: bool) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("CB"), &active);
}

pub fn get_logistics_data(env: &Env, id: u32) -> Result<LogisticsData, Error> {
    let key = (soroban_sdk::symbol_short!("LOG"), id);
    env.storage().persistent().get(&key).ok_or(Error::DataNotFound)
}

pub fn set_logistics_data(env: &Env, data: &LogisticsData) {
    let key = (soroban_sdk::symbol_short!("LOG"), data.id);
    env.storage().persistent().set(&key, data);
}

pub fn get_provenance_count(env: &Env, shipment_id: &soroban_sdk::String) -> u32 {
    let key = (soroban_sdk::symbol_short!("PCNT"), shipment_id.clone());
    env.storage().persistent().get(&key).unwrap_or(0u32)
}

pub fn set_provenance_count(env: &Env, shipment_id: &soroban_sdk::String, count: u32) {
    let key = (soroban_sdk::symbol_short!("PCNT"), shipment_id.clone());
    env.storage().persistent().set(&key, &count);
}

pub fn get_provenance_record(
    env: &Env,
    shipment_id: &soroban_sdk::String,
    index: u32,
) -> Option<ProvenanceRecord> {
    let key = (soroban_sdk::symbol_short!("PROV"), shipment_id.clone(), index);
    env.storage().persistent().get(&key)
}

pub fn set_provenance_record(env: &Env, record: &ProvenanceRecord, index: u32) {
    let key = (soroban_sdk::symbol_short!("PROV"), record.shipment_id.clone(), index);
    env.storage().persistent().set(&key, record);
}

pub fn get_source(env: &Env, source: &Address) -> Option<DataSource> {
    let key = (soroban_sdk::symbol_short!("SRC"), source.clone());
    env.storage().persistent().get(&key)
}

pub fn set_source(env: &Env, source: &DataSource) {
    let key = (soroban_sdk::symbol_short!("SRC"), source.address.clone());
    env.storage().persistent().set(&key, source);
}

pub fn source_exists(env: &Env, source: &Address) -> bool {
    let key = (soroban_sdk::symbol_short!("SRC"), source.clone());
    env.storage().persistent().has(&key)
}
