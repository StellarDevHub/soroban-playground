// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataSource, Error, SportResult};

const ADMIN: &str = "ADMIN";
const INITIALIZED: &str = "INIT";
const PAUSED: &str = "PAUSED";
const RESULT_COUNT: &str = "RCOUNT";
const THRESHOLD: &str = "THRESH";
const CIRCUIT_BREAKER: &str = "CB";

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

pub fn get_result_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&soroban_sdk::symbol_short!("RCOUNT"))
        .unwrap_or(0u32)
}

pub fn set_result_count(env: &Env, count: u32) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("RCOUNT"), &count);
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

pub fn get_result(env: &Env, id: u32) -> Result<SportResult, Error> {
    let key = (soroban_sdk::symbol_short!("RES"), id);
    env.storage()
        .persistent()
        .get(&key)
        .ok_or(Error::ResultNotFound)
}

pub fn set_result(env: &Env, result: &SportResult) {
    let key = (soroban_sdk::symbol_short!("RES"), result.id);
    env.storage().persistent().set(&key, result);
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
