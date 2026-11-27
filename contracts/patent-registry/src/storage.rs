// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, BytesN};

use crate::types::{DataKey, Dispute, Error, Escrow, InstanceKey, License, Milestone, Patent};

// ── Admin / init ──────────────────────────────────────────────────────────────

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

// ── Pause ─────────────────────────────────────────────────────────────────────

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

// ── Counters ──────────────────────────────────────────────────────────────────

pub fn next_patent_id(env: &Env) -> u32 {
    let id: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::PatentCount)
        .unwrap_or(0)
        + 1;
    env.storage().instance().set(&InstanceKey::PatentCount, &id);
    id
}

pub fn next_license_id(env: &Env) -> u32 {
    let id: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::LicenseCount)
        .unwrap_or(0)
        + 1;
    env.storage()
        .instance()
        .set(&InstanceKey::LicenseCount, &id);
    id
}

pub fn next_dispute_id(env: &Env) -> u32 {
    let id: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::DisputeCount)
        .unwrap_or(0)
        + 1;
    env.storage()
        .instance()
        .set(&InstanceKey::DisputeCount, &id);
    id
}

pub fn next_escrow_id(env: &Env) -> u32 {
    let id: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::EscrowCount)
        .unwrap_or(0)
        + 1;
    env.storage().instance().set(&InstanceKey::EscrowCount, &id);
    id
}

pub fn next_milestone_id(env: &Env) -> u32 {
    let id: u32 = env
        .storage()
        .instance()
        .get(&InstanceKey::MilestoneCount)
        .unwrap_or(0)
        + 1;
    env.storage()
        .instance()
        .set(&InstanceKey::MilestoneCount, &id);
    id
}

pub fn get_patent_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::PatentCount)
        .unwrap_or(0)
}

pub fn get_license_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::LicenseCount)
        .unwrap_or(0)
}

pub fn get_dispute_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::DisputeCount)
        .unwrap_or(0)
}

pub fn get_escrow_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::EscrowCount)
        .unwrap_or(0)
}

pub fn get_milestone_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::MilestoneCount)
        .unwrap_or(0)
}

// ── Patent Hash ───────────────────────────────────────────────────────────────────

pub fn set_patent_hash(env: &Env, hash: &BytesN<32>) {
    env.storage().persistent().set(&DataKey::PatentHash(hash.clone()), &());
}

pub fn has_patent_hash(env: &Env, hash: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::PatentHash(hash.clone()))
}

pub fn set_patent(env: &Env, id: u32, patent: &Patent) {
    env.storage().persistent().set(&DataKey::Patent(id), patent);
}

pub fn get_patent(env: &Env, id: u32) -> Result<Patent, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Patent(id))
        .ok_or(Error::PatentNotFound)
}

// ── License ───────────────────────────────────────────────────────────────────

pub fn set_license(env: &Env, id: u32, license: &License) {
    env.storage()
        .persistent()
        .set(&DataKey::License(id), license);
}

pub fn get_license(env: &Env, id: u32) -> Result<License, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::License(id))
        .ok_or(Error::LicenseNotFound)
}

// ── Dispute ───────────────────────────────────────────────────────────────────

pub fn set_dispute(env: &Env, id: u32, dispute: &Dispute) {
    env.storage()
        .persistent()
        .set(&DataKey::Dispute(id), dispute);
}

pub fn get_dispute(env: &Env, id: u32) -> Result<Dispute, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Dispute(id))
        .ok_or(Error::DisputeNotFound)
}

// ── Escrow ────────────────────────────────────────────────────────────────────

pub fn set_escrow(env: &Env, id: u32, escrow: &Escrow) {
    env.storage().persistent().set(&DataKey::Escrow(id), escrow);
}

pub fn get_escrow(env: &Env, id: u32) -> Result<Escrow, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Escrow(id))
        .ok_or(Error::EscrowNotFound)
}

// ── Milestone ─────────────────────────────────────────────────────────────────

pub fn set_milestone(env: &Env, id: u32, milestone: &Milestone) {
    env.storage()
        .persistent()
        .set(&DataKey::Milestone(id), milestone);
}

pub fn get_milestone(env: &Env, id: u32) -> Result<Milestone, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Milestone(id))
        .ok_or(Error::MilestoneNotFound)
}
