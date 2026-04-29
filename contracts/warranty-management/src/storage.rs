// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{Claim, DataKey, Error, InstanceKey, Product, Warranty};

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
counter_fns!(get_warranty_count, set_warranty_count, WarrantyCount);
counter_fns!(get_claim_count, set_claim_count, ClaimCount);

pub fn set_product(env: &Env, id: u32, product: &Product) {
    env.storage()
        .persistent()
        .set(&DataKey::Product(id), product);
}

pub fn get_product(env: &Env, id: u32) -> Result<Product, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Product(id))
        .ok_or(Error::ProductNotFound)
}

pub fn set_warranty(env: &Env, id: u32, warranty: &Warranty) {
    env.storage()
        .persistent()
        .set(&DataKey::Warranty(id), warranty);
}

pub fn get_warranty(env: &Env, id: u32) -> Result<Warranty, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Warranty(id))
        .ok_or(Error::WarrantyNotFound)
}

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
