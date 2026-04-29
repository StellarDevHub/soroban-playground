// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{
    DataKey, Distribution, Error, InstanceKey, InvestorStats, Ownership, Property, ReitConfig,
};

// ── Contract State ────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&InstanceKey::Paused, &false);
}

// ── Admin ──────────────────────────────────────────────────────────────────────

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ── Pause State ───────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

// ── Counters ──────────────────────────────────────────────────────────────────

pub fn get_property_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::PropertyCount)
        .unwrap_or(0)
}

pub fn set_property_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::PropertyCount, &count);
}

pub fn increment_property_count(env: &Env) -> u32 {
    let count = get_property_count(env);
    set_property_count(env, count + 1);
    count + 1
}

pub fn get_distribution_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::DistributionCount)
        .unwrap_or(0)
}

pub fn set_distribution_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::DistributionCount, &count);
}

pub fn increment_distribution_count(env: &Env) -> u64 {
    let count = get_distribution_count(env);
    set_distribution_count(env, count + 1);
    count + 1
}

// ── REIT Configuration ────────────────────────────────────────────────────────

pub fn set_reit_config(env: &Env, config: &ReitConfig) {
    env.storage().instance().set(&InstanceKey::ReitConfig, config);
}

pub fn get_reit_config(env: &Env) -> Result<ReitConfig, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::ReitConfig)
        .ok_or(Error::NotInitialized)
}

pub fn update_reit_stats<F>(env: &Env, f: F) -> Result<(), Error>
where
    F: FnOnce(&mut ReitConfig),
{
    let mut config = get_reit_config(env)?;
    f(&mut config);
    set_reit_config(env, &config);
    Ok(())
}

// ── Property ──────────────────────────────────────────────────────────────────

pub fn set_property(env: &Env, id: u32, property: &Property) {
    env.storage()
        .persistent()
        .set(&DataKey::Property(id), property);
}

pub fn get_property(env: &Env, id: u32) -> Result<Property, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Property(id))
        .ok_or(Error::PropertyNotFound)
}

pub fn property_exists(env: &Env, id: u32) -> bool {
    env.storage().persistent().has(&DataKey::Property(id))
}

// ── Ownership ─────────────────────────────────────────────────────────────────

pub fn set_ownership(env: &Env, property_id: u32, investor: &Address, ownership: &Ownership) {
    env.storage().persistent().set(
        &DataKey::Ownership(property_id, investor.clone()),
        ownership,
    );
}

pub fn get_ownership(env: &Env, property_id: u32, investor: &Address) -> Result<Ownership, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Ownership(property_id, investor.clone()))
        .ok_or(Error::NoShares)
}

pub fn has_ownership(env: &Env, property_id: u32, investor: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Ownership(property_id, investor.clone()))
}

pub fn remove_ownership(env: &Env, property_id: u32, investor: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Ownership(property_id, investor.clone()));
}

// ── Investor Statistics ──────────────────────────────────────────────────────

pub fn set_investor_stats(env: &Env, investor: &Address, stats: &InvestorStats) {
    env.storage()
        .persistent()
        .set(&DataKey::InvestorStats(investor.clone()), stats);
}

pub fn get_investor_stats(env: &Env, investor: &Address) -> InvestorStats {
    env.storage()
        .persistent()
        .get(&DataKey::InvestorStats(investor.clone()))
        .unwrap_or(InvestorStats {
            properties_count: 0,
            total_shares: 0,
            total_invested: 0,
            total_dividends_claimed: 0,
            first_investment_at: 0,
            last_activity_at: 0,
        })
}

pub fn has_investor_stats(env: &Env, investor: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::InvestorStats(investor.clone()))
}

pub fn update_investor_stats<F>(env: &Env, investor: &Address, f: F)
where
    F: FnOnce(&mut InvestorStats),
{
    let mut stats = get_investor_stats(env, investor);
    f(&mut stats);
    set_investor_stats(env, investor, &stats);
}

// ── Distribution Records ─────────────────────────────────────────────────────

pub fn set_distribution(env: &Env, id: u64, distribution: &Distribution) {
    env.storage()
        .persistent()
        .set(&DataKey::Distribution(id), distribution);
}

pub fn get_distribution(env: &Env, id: u64) -> Option<Distribution> {
    env.storage().persistent().get(&DataKey::Distribution(id))
}

// ── Whitelist / Blacklist ─────────────────────────────────────────────────────

pub fn set_whitelisted(env: &Env, property_id: u32, investor: &Address, whitelisted: bool) {
    env.storage().persistent().set(
        &DataKey::Whitelist(property_id, investor.clone()),
        &whitelisted,
    );
}

pub fn is_whitelisted(env: &Env, property_id: u32, investor: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Whitelist(property_id, investor.clone()))
        .unwrap_or(false)
}

pub fn set_blacklisted(env: &Env, investor: &Address, blacklisted: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Blacklist(investor.clone()), &blacklisted);
}

pub fn is_blacklisted(env: &Env, investor: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Blacklist(investor.clone()))
        .unwrap_or(false)
}
