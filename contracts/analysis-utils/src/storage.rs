// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{
    DataKey, GasReport, InstanceKey, QualityReport, SecurityReport, VerificationResult,
};
use crate::Error;

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, a);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ── Counters ──────────────────────────────────────────────────────────────────

macro_rules! counter_fns {
    ($get:ident, $set:ident, $key:ident) => {
        pub fn $get(env: &Env) -> u32 {
            env.storage()
                .instance()
                .get(&InstanceKey::$key)
                .unwrap_or(0)
        }
        pub fn $set(env: &Env, v: u32) {
            env.storage().instance().set(&InstanceKey::$key, &v);
        }
    };
}

counter_fns!(get_security_count, set_security_count, SecurityCount);
counter_fns!(get_gas_count, set_gas_count, GasCount);
counter_fns!(get_quality_count, set_quality_count, QualityCount);
counter_fns!(get_verify_count, set_verify_count, VerifyCount);

// ── Report storage ────────────────────────────────────────────────────────────

pub fn store_security(env: &Env, r: &SecurityReport) {
    env.storage().persistent().set(&DataKey::Security(r.id), r);
}

pub fn load_security(env: &Env, id: u32) -> Result<SecurityReport, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Security(id))
        .ok_or(Error::ReportNotFound)
}

pub fn store_gas(env: &Env, r: &GasReport) {
    env.storage().persistent().set(&DataKey::Gas(r.id), r);
}

pub fn load_gas(env: &Env, id: u32) -> Result<GasReport, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Gas(id))
        .ok_or(Error::ReportNotFound)
}

pub fn store_quality(env: &Env, r: &QualityReport) {
    env.storage().persistent().set(&DataKey::Quality(r.id), r);
}

pub fn load_quality(env: &Env, id: u32) -> Result<QualityReport, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Quality(id))
        .ok_or(Error::ReportNotFound)
}

pub fn store_verify(env: &Env, r: &VerificationResult) {
    env.storage().persistent().set(&DataKey::Verify(r.id), r);
}

pub fn load_verify(env: &Env, id: u32) -> Result<VerificationResult, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Verify(id))
        .ok_or(Error::ReportNotFound)
}
