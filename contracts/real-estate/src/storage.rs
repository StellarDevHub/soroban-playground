// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Ownership, Property};

// ── Admin ─────────────────────────────────────────────────────────────────────

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

// ── Property counter ──────────────────────────────────────────────────────────

pub fn get_property_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::PropertyCount)
        .unwrap_or(0)
}

pub fn set_property_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::PropertyCount, &count);
}

// ── Property ──────────────────────────────────────────────────────────────────

pub fn set_property(env: &Env, id: u32, property: &Property) {
    env.storage()
        .persistent()
        .set(&DataKey::Property(id), property);
}

pub fn get_property(env: &Env, id: u32) -> Result<Property, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Property(id))
        .ok_or(Error::PropertyNotFound)
}

// ── Ownership ─────────────────────────────────────────────────────────────────

pub fn set_ownership(env: &Env, property_id: u32, investor: &Address, ownership: &Ownership) {
    env.storage()
        .persistent()
        .set(&DataKey::Ownership(property_id, investor.clone()), ownership);
}

pub fn get_ownership(env: &Env, property_id: u32, investor: &Address) -> Result<Ownership, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Ownership(property_id, investor.clone()))
        .ok_or(Error::NoShares)
}

pub fn has_ownership(env: &Env, property_id: u32, investor: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Ownership(property_id, investor.clone()))
}

pub fn remove_ownership(env: &Env, property_id: u32, investor: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Ownership(property_id, investor.clone()));
}
