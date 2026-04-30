// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, Report, Severity};

// ── Initialisation guard ──────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ── Pause ─────────────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

// ── Pool balance ──────────────────────────────────────────────────────────────

pub fn get_pool_balance(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::PoolBalance)
        .unwrap_or(0)
}

pub fn set_pool_balance(env: &Env, balance: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::PoolBalance, &balance);
}

// ── Reward tiers ──────────────────────────────────────────────────────────────

/// Default reward amounts in stroops (1 XLM = 10_000_000 stroops).
const DEFAULT_REWARD_LOW: i128 = 10_000_000;       // 1 XLM
const DEFAULT_REWARD_MEDIUM: i128 = 50_000_000;    // 5 XLM
const DEFAULT_REWARD_HIGH: i128 = 200_000_000;     // 20 XLM
const DEFAULT_REWARD_CRITICAL: i128 = 1_000_000_000; // 100 XLM

pub fn get_reward_for_severity(env: &Env, severity: Severity) -> i128 {
    match severity {
        Severity::Low => env
            .storage()
            .instance()
            .get(&InstanceKey::RewardLow)
            .unwrap_or(DEFAULT_REWARD_LOW),
        Severity::Medium => env
            .storage()
            .instance()
            .get(&InstanceKey::RewardMedium)
            .unwrap_or(DEFAULT_REWARD_MEDIUM),
        Severity::High => env
            .storage()
            .instance()
            .get(&InstanceKey::RewardHigh)
            .unwrap_or(DEFAULT_REWARD_HIGH),
        Severity::Critical => env
            .storage()
            .instance()
            .get(&InstanceKey::RewardCritical)
            .unwrap_or(DEFAULT_REWARD_CRITICAL),
    }
}

pub fn set_reward_for_severity(env: &Env, severity: Severity, amount: i128) {
    let key = match severity {
        Severity::Low => InstanceKey::RewardLow,
        Severity::Medium => InstanceKey::RewardMedium,
        Severity::High => InstanceKey::RewardHigh,
        Severity::Critical => InstanceKey::RewardCritical,
    };
    env.storage().instance().set(&key, &amount);
}

// ── Report count ──────────────────────────────────────────────────────────────

pub fn get_report_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::ReportCount)
        .unwrap_or(0)
}

pub fn set_report_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::ReportCount, &count);
}

// ── Reports ───────────────────────────────────────────────────────────────────

pub fn set_report(env: &Env, report: &Report) {
    env.storage()
        .persistent()
        .set(&DataKey::Report(report.id), report);
}

pub fn get_report(env: &Env, id: u32) -> Result<Report, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Report(id))
        .ok_or(Error::ReportNotFound)
}

// ── Open-report guard ─────────────────────────────────────────────────────────

pub fn has_open_report(env: &Env, reporter: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::HasOpenReport(reporter.clone()))
}

pub fn set_open_report_flag(env: &Env, reporter: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::HasOpenReport(reporter.clone()), &true);
}

pub fn clear_open_report_flag(env: &Env, reporter: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::HasOpenReport(reporter.clone()));
}
