// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Storage management for the Job Marketplace contract

use soroban_sdk::{Env, Address, Symbol, String};
use crate::types::{Job, Skill, Certification, Dispute};

/// Storage keys
const JOB_COUNT_KEY: &str = "job_count";
const JOB_PREFIX: &str = "job_";
const SKILL_PREFIX: &str = "skill_";
const CERT_PREFIX: &str = "cert_";
const DISPUTE_COUNT_KEY: &str = "dispute_count";
const DISPUTE_PREFIX: &str = "dispute_";
const PAUSED_KEY: &str = "paused";
const ADMIN_KEY: &str = "admin";

// ── Job Storage ───────────────────────────────────────────────────────────────

pub fn get_job_count(env: &Env) -> u64 {
    env.storage().instance().get(&Symbol::new(env, JOB_COUNT_KEY)).unwrap_or(0)
}

pub fn set_job_count(env: &Env, count: u64) {
    env.storage().instance().set(&Symbol::new(env, JOB_COUNT_KEY), &count);
}

pub fn get_job(env: &Env, job_id: u64) -> Option<Job> {
    let key = String::from_str(env, &format!("{}{}", JOB_PREFIX, job_id));
    env.storage().persistent().get(&key)
}

pub fn set_job(env: &Env, job_id: u64, job: &Job) {
    let key = String::from_str(env, &format!("{}{}", JOB_PREFIX, job_id));
    env.storage().persistent().set(&key, job);
}

// ── Skill Storage ─────────────────────────────────────────────────────────────

pub fn has_skill(env: &Env, user: &Address, skill: &Symbol) -> bool {
    let key = (Symbol::new(env, SKILL_PREFIX), user.clone(), skill.clone());
    env.storage().persistent().get(&key).is_some()
}

pub fn get_skill(env: &Env, user: &Address, skill: &Symbol) -> Option<Skill> {
    let key = (Symbol::new(env, SKILL_PREFIX), user.clone(), skill.clone());
    env.storage().persistent().get(&key)
}

pub fn set_skill(env: &Env, user: &Address, skill: &Symbol, skill_record: &Skill) {
    let key = (Symbol::new(env, SKILL_PREFIX), user.clone(), skill.clone());
    env.storage().persistent().set(&key, skill_record);
}

// ── Certification Storage ─────────────────────────────────────────────────────

pub fn has_certification(env: &Env, user: &Address, name: &String) -> bool {
    let key = (Symbol::new(env, CERT_PREFIX), user.clone(), name.clone());
    env.storage().persistent().get(&key).is_some()
}

pub fn get_certification(env: &Env, user: &Address, name: &String) -> Option<Certification> {
    let key = (Symbol::new(env, CERT_PREFIX), user.clone(), name.clone());
    env.storage().persistent().get(&key)
}

pub fn set_certification(env: &Env, user: &Address, name: &String, cert: &Certification) {
    let key = (Symbol::new(env, CERT_PREFIX), user.clone(), name.clone());
    env.storage().persistent().set(&key, cert);
}

// ── Dispute Storage ───────────────────────────────────────────────────────────

pub fn get_dispute_count(env: &Env) -> u64 {
    env.storage().instance().get(&Symbol::new(env, DISPUTE_COUNT_KEY)).unwrap_or(0)
}

pub fn set_dispute_count(env: &Env, count: u64) {
    env.storage().instance().set(&Symbol::new(env, DISPUTE_COUNT_KEY), &count);
}

pub fn get_dispute(env: &Env, dispute_id: u64) -> Option<Dispute> {
    let key = String::from_str(env, &format!("{}{}", DISPUTE_PREFIX, dispute_id));
    env.storage().persistent().get(&key)
}

pub fn set_dispute(env: &Env, dispute_id: u64, dispute: &Dispute) {
    let key = String::from_str(env, &format!("{}{}", DISPUTE_PREFIX, dispute_id));
    env.storage().persistent().set(&key, dispute);
}

// ── Contract State ────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&Symbol::new(env, PAUSED_KEY)).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&Symbol::new(env, PAUSED_KEY), &paused);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&Symbol::new(env, ADMIN_KEY))
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&Symbol::new(env, ADMIN_KEY), admin);
}
