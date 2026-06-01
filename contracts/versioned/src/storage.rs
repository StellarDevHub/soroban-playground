// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, InstanceKey, MigrationRecord, Version};
use crate::Error;

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

pub fn get_current_index(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::CurrentIndex)
        .unwrap_or(0)
}

pub fn set_current_index(env: &Env, idx: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::CurrentIndex, &idx);
}

pub fn get_version_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::VersionCount)
        .unwrap_or(0)
}

pub fn set_version_count(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::VersionCount, &v);
}

pub fn store_version(env: &Env, idx: u32, ver: &Version) {
    env.storage()
        .persistent()
        .set(&DataKey::VersionAt(idx), ver);
}

pub fn load_version(env: &Env, idx: u32) -> Result<Version, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::VersionAt(idx))
        .ok_or(Error::VersionNotFound)
}

pub fn get_migration_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::MigrationCount)
        .unwrap_or(0)
}

pub fn set_migration_count(env: &Env, v: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::MigrationCount, &v);
}

pub fn store_migration(env: &Env, idx: u32, rec: &MigrationRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::MigrationAt(idx), rec);
}

pub fn load_migration(env: &Env, idx: u32) -> Result<MigrationRecord, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::MigrationAt(idx))
        .ok_or(Error::VersionNotFound)
}
