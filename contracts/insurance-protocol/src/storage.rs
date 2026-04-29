// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{Claim, CoverageProduct, DataKey, Error, InstanceKey, Policy};

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

// ── Counters ──────────────────────────────────────────────────────────────────

macro_rules! counter_fns {
    ($get:ident, $set:ident, $key:ident) => {
        pub fn $get(env: &Env) -> u32 {
            env.storage()
                .instance()
                .get(&InstanceKey::$key)
                .unwrap_or(0)
        }
        pub fn $set(env: &Env, v: u32) {
            env.storage().instance().set(&InstanceKey::$key, &v);
        }
    };
}

counter_fns!(get_product_count, set_product_count, ProductCount);
counter_fns!(get_policy_count, set_policy_count, PolicyCount);
counter_fns!(get_claim_count, set_claim_count, ClaimCount);

// ── Products ──────────────────────────────────────────────────────────────────

pub fn set_product(env: &Env, id: u32, product: &CoverageProduct) {
    env.storage()
        .persistent()
        .set(&DataKey::Product(id), product);
}

pub fn get_product(env: &Env, id: u32) -> Result<CoverageProduct, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Product(id))
        .ok_or(Error::ProductNotFound)
}

// ── Policies ──────────────────────────────────────────────────────────────────

pub fn set_policy(env: &Env, id: u32, policy: &Policy) {
    env.storage()
        .persistent()
        .set(&DataKey::Policy(id), policy);
}

pub fn get_policy(env: &Env, id: u32) -> Result<Policy, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Policy(id))
        .ok_or(Error::PolicyNotFound)
}

// ── Claims ────────────────────────────────────────────────────────────────────

pub fn set_claim(env: &Env, id: u32, claim: &Claim) {
    env.storage()
        .persistent()
        .set(&DataKey::Claim(id), claim);
}

pub fn get_claim(env: &Env, id: u32) -> Result<Claim, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Claim(id))
        .ok_or(Error::ClaimNotFound)
}

// ── Votes ─────────────────────────────────────────────────────────────────────

pub fn has_voted(env: &Env, claim_id: u32, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Vote(claim_id, voter.clone()))
}

pub fn record_vote(env: &Env, claim_id: u32, voter: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Vote(claim_id, voter.clone()), &true);
}
