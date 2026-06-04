// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, BytesN, Env};

use crate::types::InstanceKey;
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

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &v);
}

pub fn get_timelock(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::TimelockLedgers)
        .unwrap_or(0u32)
}

pub fn set_timelock(env: &Env, v: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::TimelockLedgers, &v);
}

pub fn set_pending_upgrade(env: &Env, new_hash: &BytesN<32>, proposed_at: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::PendingHash, new_hash);
    env.storage()
        .instance()
        .set(&InstanceKey::UpgradeProposedAt, &proposed_at);
}

pub fn get_pending_upgrade(env: &Env) -> Option<(BytesN<32>, u32)> {
    let hash: Option<BytesN<32>> = env.storage().instance().get(&InstanceKey::PendingHash);
    let at: Option<u32> = env.storage().instance().get(&InstanceKey::UpgradeProposedAt);
    match (hash, at) {
        (Some(h), Some(a)) => Some((h, a)),
        _ => None,
    }
}

pub fn clear_pending_upgrade(env: &Env) {
    env.storage().instance().remove(&InstanceKey::PendingHash);
    env.storage()
        .instance()
        .remove(&InstanceKey::UpgradeProposedAt);
}
