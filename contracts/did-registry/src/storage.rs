// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracttype, Address, Env};

use crate::types::{Credential, Error, Identity};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
enum InstanceKey {
    Admin,
    CredCount,
}

#[contracttype]
enum DataKey {
    Identity(Address),
    Credential(u32),
}

// ── Admin / init ──────────────────────────────────────────────────────────────

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

// ── Identity ──────────────────────────────────────────────────────────────────

pub fn save_identity(env: &Env, identity: &Identity) {
    env.storage()
        .persistent()
        .set(&DataKey::Identity(identity.owner.clone()), identity);
}

pub fn load_identity(env: &Env, owner: &Address) -> Result<Identity, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Identity(owner.clone()))
        .ok_or(Error::IdentityNotFound)
}

pub fn has_identity(env: &Env, owner: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Identity(owner.clone()))
}

// ── Credentials ───────────────────────────────────────────────────────────────

pub fn next_credential_id(env: &Env) -> u32 {
    let id: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::CredCount)
        .unwrap_or(0u32)
        + 1;
    env.storage().instance().set(&InstanceKey::CredCount, &id);
    id
}

pub fn credential_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::CredCount)
        .unwrap_or(0u32)
}

pub fn save_credential(env: &Env, cred: &Credential) {
    env.storage()
        .persistent()
        .set(&DataKey::Credential(cred.id), cred);
}

pub fn load_credential(env: &Env, id: u32) -> Result<Credential, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Credential(id))
        .ok_or(Error::CredentialNotFound)
}
