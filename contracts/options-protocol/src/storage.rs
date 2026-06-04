// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, OptionContract};

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

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn get_option_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::OptionCount)
        .unwrap_or(0)
}

pub fn set_option_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::OptionCount, &count);
}

pub fn set_option(env: &Env, option: &OptionContract) {
    env.storage()
        .persistent()
        .set(&DataKey::Option(option.id), option);
}

pub fn get_option(env: &Env, id: u32) -> Result<OptionContract, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Option(id))
        .ok_or(Error::OptionNotFound)
}
