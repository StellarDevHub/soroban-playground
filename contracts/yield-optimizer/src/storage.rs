// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{AdvancedStrategy, DataKey, Error, InstanceKey, Position, Strategy};

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
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &v);
}

pub fn get_strategy_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::StrategyCount)
        .unwrap_or(0)
}

pub fn set_strategy_count(env: &Env, v: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::StrategyCount, &v);
}

pub fn set_strategy(env: &Env, id: u32, s: &Strategy) {
    env.storage().persistent().set(&DataKey::Strategy(id), s);
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

pub fn set_advanced_strategy(env: &Env, id: u32, s: &AdvancedStrategy) {
    env.storage()
        .persistent()
        .set(&DataKey::AdvancedStrategy(id), s);
}

pub fn get_advanced_strategy(env: &Env, id: u32) -> Result<AdvancedStrategy, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::AdvancedStrategy(id))
        .ok_or(Error::StrategyNotFound)
}

pub fn has_advanced_strategy(env: &Env, id: u32) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::AdvancedStrategy(id))
}

pub fn set_position(env: &Env, sid: u32, user: &Address, p: &Position) {
    env.storage()
        .persistent()
        .set(&DataKey::Position(sid, user.clone()), p);
}

pub fn get_position(env: &Env, sid: u32, user: &Address) -> Result<Position, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Position(sid, user.clone()))
        .ok_or(Error::NoPosition)
}

pub fn has_position(env: &Env, sid: u32, user: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Position(sid, user.clone()))
}

pub fn remove_position(env: &Env, sid: u32, user: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Position(sid, user.clone()));
}
