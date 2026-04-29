// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{Checkpoint, DataKey, Error, InstanceKey, Product, QualityReport};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}
pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}
pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::Admin).ok_or(Error::NotInitialized)
}

pub fn get_product_count(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::ProductCount).unwrap_or(0)
}
pub fn set_product_count(env: &Env, v: u32) {
    env.storage().instance().set(&InstanceKey::ProductCount, &v);
}

// ── Products ──────────────────────────────────────────────────────────────────

pub fn set_product(env: &Env, p: &Product) {
    env.storage().persistent().set(&DataKey::Product(p.id), p);
}
pub fn get_product(env: &Env, id: u32) -> Result<Product, Error> {
    env.storage().persistent().get(&DataKey::Product(id)).ok_or(Error::ProductNotFound)
}

// ── Checkpoints ───────────────────────────────────────────────────────────────

pub fn get_checkpoint_count(env: &Env, product_id: u32) -> u32 {
    env.storage().persistent().get(&DataKey::CheckpointCount(product_id)).unwrap_or(0)
}
pub fn set_checkpoint_count(env: &Env, product_id: u32, v: u32) {
    env.storage().persistent().set(&DataKey::CheckpointCount(product_id), &v);
}
pub fn set_checkpoint(env: &Env, c: &Checkpoint) {
    env.storage().persistent().set(&DataKey::Checkpoint(c.product_id, c.index), c);
}
pub fn get_checkpoint(env: &Env, product_id: u32, index: u32) -> Option<Checkpoint> {
    env.storage().persistent().get(&DataKey::Checkpoint(product_id, index))
}

// ── Quality reports ───────────────────────────────────────────────────────────

pub fn set_quality_report(env: &Env, r: &QualityReport) {
    env.storage().persistent().set(&DataKey::QualityReport(r.product_id), r);
}
pub fn get_quality_report(env: &Env, product_id: u32) -> Result<QualityReport, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::QualityReport(product_id))
        .ok_or(Error::QualityReportNotFound)
}

// ── Role management ───────────────────────────────────────────────────────────

pub fn is_inspector(env: &Env, addr: &Address) -> bool {
    env.storage().persistent().get(&DataKey::Inspector(addr.clone())).unwrap_or(false)
}
pub fn set_inspector(env: &Env, addr: &Address, v: bool) {
    env.storage().persistent().set(&DataKey::Inspector(addr.clone()), &v);
}
pub fn is_handler(env: &Env, addr: &Address) -> bool {
    env.storage().persistent().get(&DataKey::Handler(addr.clone())).unwrap_or(false)
}
pub fn set_handler(env: &Env, addr: &Address, v: bool) {
    env.storage().persistent().set(&DataKey::Handler(addr.clone()), &v);
}

// ── Pause ─────────────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&InstanceKey::Paused).unwrap_or(false)
}
pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &v);
}
