// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};
use crate::types::{Claim, DataKey, Error, InstanceKey, Product, Warranty};

const TTL: u32 = 518400;

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}
pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
    env.storage().instance().extend_ttl(TTL, TTL);
}
pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::Admin).ok_or(Error::NotInitialized)
}
pub fn set_paused(env: &Env, v: bool) { env.storage().instance().set(&InstanceKey::Paused, &v); }
pub fn is_paused(env: &Env) -> bool { env.storage().instance().get(&InstanceKey::Paused).unwrap_or(false) }

macro_rules! count {
    ($s:ident, $g:ident, $k:ident) => {
        pub fn $s(env: &Env, n: u32) { env.storage().instance().set(&InstanceKey::$k, &n); }
        pub fn $g(env: &Env) -> u32 { env.storage().instance().get(&InstanceKey::$k).unwrap_or(0) }
    };
}
count!(set_product_count, get_product_count, ProductCount);
count!(set_warranty_count, get_warranty_count, WarrantyCount);
count!(set_claim_count, get_claim_count, ClaimCount);

macro_rules! persist {
    ($s:ident, $g:ident, $T:ty, $kv:ident, $err:ident) => {
        pub fn $s(env: &Env, id: u32, v: &$T) {
            let k = DataKey::$kv(id);
            env.storage().persistent().set(&k, v);
            env.storage().persistent().extend_ttl(&k, TTL, TTL);
        }
        pub fn $g(env: &Env, id: u32) -> Result<$T, Error> {
            env.storage().persistent().get(&DataKey::$kv(id)).ok_or(Error::$err)
        }
    };
}
persist!(set_product, get_product, Product, Product, ProductNotFound);
persist!(set_warranty, get_warranty, Warranty, Warranty, WarrantyNotFound);
persist!(set_claim, get_claim, Claim, Claim, ClaimNotFound);
