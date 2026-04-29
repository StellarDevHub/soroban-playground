// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{symbol_short, Address, Env, Symbol};

use crate::types::{Error, Merchant, UserStats};

// ── Storage keys ──────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const PAUSED: Symbol = symbol_short!("PAUSED");
const MERCH_CNT: Symbol = symbol_short!("MERCH_CNT");

fn merchant_key(id: u32) -> (Symbol, u32) {
    (symbol_short!("MERCH"), id)
}

fn balance_key(user: &Address) -> (Symbol, Address) {
    (symbol_short!("BAL"), user.clone())
}

fn stats_key(user: &Address) -> (Symbol, Address) {
    (symbol_short!("STATS"), user.clone())
}

// ── Admin / pause ─────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&ADMIN)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&ADMIN)
        .ok_or(Error::NotInitialized)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&PAUSED, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&PAUSED).unwrap_or(false)
}

// ── Merchant ──────────────────────────────────────────────────────────────────

pub fn get_merchant_count(env: &Env) -> u32 {
    env.storage().instance().get(&MERCH_CNT).unwrap_or(0)
}

pub fn set_merchant_count(env: &Env, count: u32) {
    env.storage().instance().set(&MERCH_CNT, &count);
}

pub fn get_merchant(env: &Env, id: u32) -> Result<Merchant, Error> {
    env.storage()
        .persistent()
        .get(&merchant_key(id))
        .ok_or(Error::MerchantNotFound)
}

pub fn set_merchant(env: &Env, merchant: &Merchant) {
    env.storage()
        .persistent()
        .set(&merchant_key(merchant.id), merchant);
}

// ── User balance ──────────────────────────────────────────────────────────────

pub fn get_balance(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&balance_key(user))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, user: &Address, balance: i128) {
    env.storage()
        .persistent()
        .set(&balance_key(user), &balance);
}

// ── User stats ────────────────────────────────────────────────────────────────

pub fn get_user_stats(env: &Env, user: &Address) -> UserStats {
    env.storage()
        .persistent()
        .get(&stats_key(user))
        .unwrap_or(UserStats {
            total_earned: 0,
            total_redeemed: 0,
            last_activity: 0,
        })
}

pub fn set_user_stats(env: &Env, user: &Address, stats: &UserStats) {
    env.storage().persistent().set(&stats_key(user), stats);
}
