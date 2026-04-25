// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey};

macro_rules! instance_get {
    ($fn:ident, $key:ident, $t:ty, $default:expr) => {
        pub fn $fn(env: &Env) -> $t {
            env.storage().instance().get(&InstanceKey::$key).unwrap_or($default)
        }
    };
}
macro_rules! instance_set {
    ($fn:ident, $key:ident, $t:ty) => {
        pub fn $fn(env: &Env, v: $t) {
            env.storage().instance().set(&InstanceKey::$key, &v);
        }
    };
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}
#[allow(dead_code)]
pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::Admin).ok_or(Error::NotInitialized)
}

pub fn set_token_a(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::TokenA, a);
}
pub fn get_token_a(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::TokenA).ok_or(Error::NotInitialized)
}
pub fn set_token_b(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::TokenB, a);
}
pub fn get_token_b(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::TokenB).ok_or(Error::NotInitialized)
}

instance_get!(get_reserve_a, ReserveA, i128, 0);
instance_set!(set_reserve_a, ReserveA, i128);
instance_get!(get_reserve_b, ReserveB, i128, 0);
instance_set!(set_reserve_b, ReserveB, i128);
instance_get!(get_total_lp, TotalLp, i128, 0);
instance_set!(set_total_lp, TotalLp, i128);
instance_get!(get_price_a_cum, PriceACum, i128, 0);
instance_set!(set_price_a_cum, PriceACum, i128);
instance_get!(get_price_b_cum, PriceBCum, i128, 0);
instance_set!(set_price_b_cum, PriceBCum, i128);
instance_get!(get_last_ts, LastTimestamp, u64, 0);
instance_set!(set_last_ts, LastTimestamp, u64);
instance_get!(get_fee_bps, FeeBps, i128, 30);
instance_set!(set_fee_bps, FeeBps, i128);

// ── LP balances ───────────────────────────────────────────────────────────────

pub fn get_lp(env: &Env, addr: &Address) -> i128 {
    env.storage().persistent().get(&DataKey::Lp(addr.clone())).unwrap_or(0)
}

pub fn set_lp(env: &Env, addr: &Address, amount: i128) {
    env.storage().persistent().set(&DataKey::Lp(addr.clone()), &amount);
}
