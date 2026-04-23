// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Position, Strategy};

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

// ── Strategy counter ─────────────────────────────────────────────────────────

pub fn get_strategy_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::StrategyCount)
        .unwrap_or(0)
}

pub fn set_strategy_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::StrategyCount, &count);
}

// ── Strategy ─────────────────────────────────────────────────────────────────

pub fn set_strategy(env: &Env, id: u32, strategy: &Strategy) {
    env.storage()
        .persistent()
        .set(&DataKey::Strategy(id), strategy);
}

pub fn get_strategy(env: &Env, id: u32) -> Result<Strategy, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Strategy(id))
        .ok_or(Error::StrategyNotFound)
}

pub fn has_strategy(env: &Env, id: u32) -> bool {
    env.storage().persistent().has(&DataKey::Strategy(id))
}

// ── Position ─────────────────────────────────────────────────────────────────

pub fn set_position(env: &Env, strategy_id: u32, user: &Address, position: &Position) {
    env.storage()
        .persistent()
        .set(&DataKey::Position(strategy_id, user.clone()), position);
}

pub fn get_position(env: &Env, strategy_id: u32, user: &Address) -> Result<Position, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Position(strategy_id, user.clone()))
        .ok_or(Error::NoPosition)
}

pub fn has_position(env: &Env, strategy_id: u32, user: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Position(strategy_id, user.clone()))
}

pub fn remove_position(env: &Env, strategy_id: u32, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Position(strategy_id, user.clone()));
}
