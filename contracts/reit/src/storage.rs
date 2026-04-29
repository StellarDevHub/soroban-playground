// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, Holding, InstanceKey, Property};

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

pub fn get_property_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::PropertyCount)
        .unwrap_or(0)
}

pub fn set_property_count(env: &Env, v: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::PropertyCount, &v);
}

pub fn set_property(env: &Env, id: u32, p: &Property) {
    env.storage().persistent().set(&DataKey::Property(id), p);
}

pub fn get_property(env: &Env, id: u32) -> Result<Property, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Property(id))
        .ok_or(Error::PropertyNotFound)
}

pub fn set_holding(env: &Env, pid: u32, investor: &Address, h: &Holding) {
    env.storage()
        .persistent()
        .set(&DataKey::Holding(pid, investor.clone()), h);
}

pub fn get_holding(env: &Env, pid: u32, investor: &Address) -> Option<Holding> {
    env.storage()
        .persistent()
        .get(&DataKey::Holding(pid, investor.clone()))
}

pub fn remove_holding(env: &Env, pid: u32, investor: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Holding(pid, investor.clone()));
}
