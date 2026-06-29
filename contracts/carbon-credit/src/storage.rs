// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, IssuerInfo, RetirementRecord};

// ── Initialisation guard ──────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Global supply / retirement counters ───────────────────────────────────────

pub fn get_total_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalSupply)
        .unwrap_or(0)
}

pub fn set_total_supply(env: &Env, supply: i128) {
    env.storage().instance().set(&DataKey::TotalSupply, &supply);
}

pub fn get_total_retired(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TotalRetired)
        .unwrap_or(0)
}

pub fn set_total_retired(env: &Env, retired: i128) {
    env.storage()
        .instance()
        .set(&DataKey::TotalRetired, &retired);
}

pub fn get_retirement_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::RetirementCount)
        .unwrap_or(0)
}

pub fn set_retirement_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&DataKey::RetirementCount, &count);
}

// ── Per-account balances ──────────────────────────────────────────────────────

pub fn get_balance(env: &Env, addr: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(addr.clone()))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, addr: &Address, balance: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(addr.clone()), &balance);
}

// ── Issuer registry ───────────────────────────────────────────────────────────

pub fn get_issuer_info(env: &Env, issuer: &Address) -> Option<IssuerInfo> {
    env.storage()
        .persistent()
        .get(&DataKey::IssuerInfo(issuer.clone()))
}

pub fn set_issuer_info(env: &Env, issuer: &Address, info: &IssuerInfo) {
    env.storage()
        .persistent()
        .set(&DataKey::IssuerInfo(issuer.clone()), info);
}

// ── Retirement ledger ─────────────────────────────────────────────────────────

pub fn save_retirement(env: &Env, record: &RetirementRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Retirement(record.id), record);
}

pub fn get_retirement(env: &Env, id: u32) -> Result<RetirementRecord, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Retirement(id))
        .ok_or(Error::RetirementNotFound)
}
