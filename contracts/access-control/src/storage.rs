// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, InstanceKey};
use crate::Error;

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Owner)
}

pub fn set_owner(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Owner, a);
}

pub fn get_owner(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Owner)
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

pub fn has_role(env: &Env, addr: &Address, role: u32) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::HasRole(addr.clone(), role))
        .unwrap_or(false)
}

pub fn set_role(env: &Env, addr: &Address, role: u32, granted: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::HasRole(addr.clone(), role), &granted);
}
