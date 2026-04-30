// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, InstanceKey, Order};

// ── Instance storage ──────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&InstanceKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
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

pub fn get_order_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::OrderCount)
        .unwrap_or(0u64)
}

pub fn set_order_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::OrderCount, &count);
}

pub fn get_total_volume(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalVolume)
        .unwrap_or(0i128)
}

pub fn add_total_volume(env: &Env, amount: i128) {
    let v = get_total_volume(env);
    env.storage()
        .instance()
        .set(&InstanceKey::TotalVolume, &(v + amount));
}

// ── Persistent storage ────────────────────────────────────────────────────────

pub fn get_order(env: &Env, id: u64) -> Option<Order> {
    env.storage().persistent().get(&DataKey::Order(id))
}

pub fn set_order(env: &Env, order: &Order) {
    env.storage()
        .persistent()
        .set(&DataKey::Order(order.id), order);
}
