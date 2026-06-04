// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Analysis Utils Contract  (Issue #595)
//!
//! Provides on-chain storage of contract analysis results produced by off-chain
//! tooling (static analysers, gas estimators, formal verifiers).  The contract
//! acts as an immutable, admin-gated audit ledger for four analysis types:
//!
//! * **Security scan** — vulnerability severity and finding count.
//! * **Gas analysis** — average / worst-case gas usage and optimisation score.
//! * **Code quality** — overall score and warning count.
//! * **Property verification** — whether a named property holds.
//!
//! Off-chain tools submit results; any consumer can read them permissionlessly.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Address, BytesN, Env, String};

use crate::storage::{
    get_admin, get_gas_count, get_quality_count, get_security_count, get_verify_count,
    is_initialized, load_gas, load_quality, load_security, load_verify, set_admin, set_gas_count,
    set_quality_count, set_security_count, set_verify_count, store_gas, store_quality,
    store_security, store_verify,
};
use crate::types::{
    GasReport, QualityReport, SecurityReport, SeverityLevel, VerificationResult,
};

/// Errors returned by the analysis-utils contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ReportNotFound = 4,
    InvalidInput = 5,
}

#[contract]
pub struct AnalysisUtils;

#[contractimpl]
impl AnalysisUtils {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Security scan ─────────────────────────────────────────────────────────

    /// Record a security scan result. Admin only. Returns report ID.
    pub fn record_security(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        severity: SeverityLevel,
        finding_count: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let id = get_security_count(&env);
        let report = SecurityReport {
            id,
            contract_hash,
            severity,
            finding_count,
            scanned_at: env.ledger().timestamp(),
        };
        store_security(&env, &report);
        set_security_count(&env, id + 1);
        env.events().publish((symbol_short!("sec"),), (id, severity as u32, finding_count));
        Ok(id)
    }

    pub fn get_security_report(env: Env, id: u32) -> Result<SecurityReport, Error> {
        ensure_initialized(&env)?;
        load_security(&env, id)
    }

    pub fn get_security_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_security_count(&env))
    }

    // ── Gas analysis ──────────────────────────────────────────────────────────

    /// Record a gas analysis result. Admin only. Returns report ID.
    pub fn record_gas(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        avg_gas: u64,
        max_gas: u64,
        optimisation_score: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if optimisation_score > 100 {
            return Err(Error::InvalidInput);
        }
        if avg_gas > max_gas {
            return Err(Error::InvalidInput);
        }

        let id = get_gas_count(&env);
        let report = GasReport {
            id,
            contract_hash,
            avg_gas,
            max_gas,
            optimisation_score,
            analysed_at: env.ledger().timestamp(),
        };
        store_gas(&env, &report);
        set_gas_count(&env, id + 1);
        env.events().publish((symbol_short!("gas"),), (id, avg_gas, optimisation_score));
        Ok(id)
    }

    pub fn get_gas_report(env: Env, id: u32) -> Result<GasReport, Error> {
        ensure_initialized(&env)?;
        load_gas(&env, id)
    }

    pub fn get_gas_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_gas_count(&env))
    }

    // ── Code quality ──────────────────────────────────────────────────────────

    /// Record a code-quality check result. Admin only. Returns report ID.
    pub fn record_quality(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        score: u32,
        warning_count: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if score > 100 {
            return Err(Error::InvalidInput);
        }

        let id = get_quality_count(&env);
        let report = QualityReport {
            id,
            contract_hash,
            score,
            warning_count,
            checked_at: env.ledger().timestamp(),
        };
        store_quality(&env, &report);
        set_quality_count(&env, id + 1);
        env.events().publish((symbol_short!("qual"),), (id, score, warning_count));
        Ok(id)
    }

    pub fn get_quality_report(env: Env, id: u32) -> Result<QualityReport, Error> {
        ensure_initialized(&env)?;
        load_quality(&env, id)
    }

    pub fn get_quality_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_quality_count(&env))
    }

    // ── Property verification ─────────────────────────────────────────────────

    /// Record a formal-property verification result. Admin only. Returns result ID.
    pub fn record_verification(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        property: String,
        holds: bool,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if property.is_empty() {
            return Err(Error::InvalidInput);
        }

        let id = get_verify_count(&env);
        let result = VerificationResult {
            id,
            contract_hash,
            property,
            holds,
            verified_at: env.ledger().timestamp(),
        };
        store_verify(&env, &result);
        set_verify_count(&env, id + 1);
        env.events().publish((symbol_short!("verify"),), (id, holds));
        Ok(id)
    }

    pub fn get_verification_result(env: Env, id: u32) -> Result<VerificationResult, Error> {
        ensure_initialized(&env)?;
        load_verify(&env, id)
    }

    pub fn get_verification_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_verify_count(&env))
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
