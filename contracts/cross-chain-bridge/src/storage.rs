// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Deposit, Error, InstanceKey, BridgeStats};

// ── Admin ────────────────────────────────────────────────────────────────────

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

// ── Pause ────────────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::IsPaused, &paused);
}

// ── Fee ──────────────────────────────────────────────────────────────────────

pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::FeeBps)
        .unwrap_or(30) // default 0.3%
}

pub fn set_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&InstanceKey::FeeBps, &bps);
}

// ── Expiry ───────────────────────────────────────────────────────────────────

pub fn get_expiry_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::ExpirySeconds)
        .unwrap_or(86_400) // default 24 h
}

pub fn set_expiry_seconds(env: &Env, secs: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::ExpirySeconds, &secs);
}

// ── Daily limit ───────────────────────────────────────────────────────────────

pub fn get_daily_limit(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::DailyLimit)
        .unwrap_or(i128::MAX)
}

pub fn set_daily_limit(env: &Env, limit: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::DailyLimit, &limit);
}

pub fn get_daily_volume(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::DailyVolume)
        .unwrap_or(0)
}

pub fn get_daily_volume_ts(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::DailyVolumeTs)
        .unwrap_or(0)
}

/// Accumulate volume; resets if a new day has started (86400 s window).
pub fn accumulate_daily_volume(env: &Env, amount: i128) -> i128 {
    let now = env.ledger().timestamp();
    let last_ts = get_daily_volume_ts(env);
    let current = if now.saturating_sub(last_ts) >= 86_400 {
        0
    } else {
        get_daily_volume(env)
    };
    let new_vol = current.saturating_add(amount);
    env.storage()
        .instance()
        .set(&InstanceKey::DailyVolume, &new_vol);
    env.storage()
        .instance()
        .set(&InstanceKey::DailyVolumeTs, &now);
    new_vol
}

// ── Deposit counter ───────────────────────────────────────────────────────────

pub fn get_deposit_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::DepositCount)
        .unwrap_or(0)
}

pub fn set_deposit_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::DepositCount, &count);
}

// ── Deposit ───────────────────────────────────────────────────────────────────

pub fn set_deposit(env: &Env, id: u32, deposit: &Deposit) {
    env.storage()
        .persistent()
        .set(&DataKey::Deposit(id), deposit);
}

pub fn get_deposit(env: &Env, id: u32) -> Result<Deposit, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Deposit(id))
        .ok_or(Error::DepositNotFound)
}

// ── Relayer ───────────────────────────────────────────────────────────────────

pub fn set_relayer(env: &Env, relayer: &Address, active: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Relayer(relayer.clone()), &active);
}

pub fn is_relayer(env: &Env, relayer: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Relayer(relayer.clone()))
        .unwrap_or(false)
}

// ── Stats ─────────────────────────────────────────────────────────────────────

pub fn get_stats(env: &Env) -> BridgeStats {
    env.storage()
        .persistent()
        .get(&DataKey::Stats)
        .unwrap_or(BridgeStats {
            total_locked: 0,
            total_minted: 0,
            total_refunded: 0,
            deposit_count: 0,
            active_deposits: 0,
        })
}

pub fn set_stats(env: &Env, stats: &BridgeStats) {
    env.storage().persistent().set(&DataKey::Stats, stats);
}
