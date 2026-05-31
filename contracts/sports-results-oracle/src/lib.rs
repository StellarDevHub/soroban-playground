// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Sports Results Oracle Contract
//!
//! Provides tamper-resistant sports data for Soroban applications.
//! Supports multiple data sources, verification thresholds, and circuit breakers.
//!
//! ## Lifecycle
//! 1. Admin calls `initialize`.
//! 2. Admin adds trusted data sources via `add_data_source`.
//! 3. Sources submit results via `submit_sports_data`.
//! 4. Once confirmations reach threshold, result is auto-verified.
//! 5. Admin can finalize or trigger circuit breaker.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_result, get_result_count, get_source, get_threshold, is_circuit_breaker_active,
    is_initialized, is_paused, set_admin, set_circuit_breaker, set_initialized, set_paused,
    set_result, set_result_count, set_source, set_threshold, source_exists,
};
use crate::types::{DataSource, Error, SportDataStatus, SportResult};

#[contract]
pub struct SportsResultsOracle;

#[contractimpl]
impl SportsResultsOracle {
    /// Initialize the contract. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        verification_threshold: Option<u32>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        if let Some(t) = verification_threshold {
            if t == 0 {
                return Err(Error::InvalidThreshold);
            }
            set_threshold(&env, t);
        }
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    /// Add a trusted data source. Admin only.
    pub fn add_data_source(
        env: Env,
        admin: Address,
        source: Address,
        name: String,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if source_exists(&env, &source) {
            return Err(Error::SourceAlreadyExists);
        }
        let ds = DataSource {
            address: source.clone(),
            name,
            active: true,
            submissions: 0,
        };
        set_source(&env, &ds);
        env.events().publish((symbol_short!("srcAdd"),), source);
        Ok(())
    }

    /// Remove a data source. Admin only.
    pub fn remove_data_source(env: Env, admin: Address, source: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut ds = get_source(&env, &source).ok_or(Error::SourceNotFound)?;
        ds.active = false;
        set_source(&env, &ds);
        env.events().publish((symbol_short!("srcRm"),), source);
        Ok(())
    }

    /// Update the verification threshold. Admin only.
    pub fn set_verification_threshold(
        env: Env,
        admin: Address,
        threshold: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        set_threshold(&env, threshold);
        Ok(())
    }

    /// Submit sports result data. Must be a registered active source.
    pub fn submit_sports_data(
        env: Env,
        submitter: Address,
        sport: String,
        event_id: String,
        home_team: String,
        away_team: String,
        home_score: u32,
        away_score: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        check_circuit_breaker(&env)?;
        submitter.require_auth();

        let mut ds = get_source(&env, &submitter).ok_or(Error::SourceNotFound)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }
        if event_id.is_empty() {
            return Err(Error::InvalidEventId);
        }

        let id = get_result_count(&env);
        let result = SportResult {
            id,
            sport,
            event_id,
            home_team,
            away_team,
            home_score,
            away_score,
            timestamp: env.ledger().timestamp(),
            status: SportDataStatus::Pending,
            submitter: submitter.clone(),
            confirmations: 1,
        };
        set_result(&env, &result);
        set_result_count(&env, id + 1);

        ds.submissions += 1;
        set_source(&env, &ds);

        env.events().publish((symbol_short!("submit"),), (id, submitter));
        Ok(id)
    }

    /// Confirm an existing result. Each active source can add one confirmation.
    /// Auto-verifies when confirmations reach threshold.
    pub fn confirm_result(env: Env, source: Address, result_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        check_circuit_breaker(&env)?;
        source.require_auth();

        let ds = get_source(&env, &source).ok_or(Error::SourceNotFound)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }

        let mut result = get_result(&env, result_id)?;
        if result.status == SportDataStatus::Finalized {
            return Err(Error::ResultAlreadyFinalized);
        }

        result.confirmations += 1;
        let threshold = get_threshold(&env);
        if result.confirmations >= threshold {
            result.status = SportDataStatus::Verified;
            env.events().publish((symbol_short!("verified"),), result_id);
        }
        set_result(&env, &result);
        Ok(())
    }

    /// Finalize a verified result. Admin only.
    pub fn finalize_result(env: Env, admin: Address, result_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut result = get_result(&env, result_id)?;
        if result.status == SportDataStatus::Finalized {
            return Err(Error::ResultAlreadyFinalized);
        }
        result.status = SportDataStatus::Finalized;
        set_result(&env, &result);
        env.events().publish((symbol_short!("final"),), result_id);
        Ok(())
    }

    /// Activate or deactivate the circuit breaker. Admin only.
    pub fn set_circuit_breaker(env: Env, admin: Address, active: bool) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_circuit_breaker(&env, active);
        env.events().publish((symbol_short!("cb"),), active);
        Ok(())
    }

    /// Pause the contract. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), admin);
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), admin);
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_sports_data(env: Env, result_id: u32) -> Result<SportResult, Error> {
        ensure_initialized(&env)?;
        get_result(&env, result_id)
    }

    pub fn get_historical_results(env: Env, from_id: u32, count: u32) -> u32 {
        // Returns the number of results available from from_id up to count
        let total = get_result_count(&env);
        if from_id >= total {
            return 0;
        }
        let available = total - from_id;
        if available < count { available } else { count }
    }

    pub fn get_result_count(env: Env) -> u32 {
        get_result_count(&env)
    }

    pub fn get_threshold(env: Env) -> u32 {
        get_threshold(&env)
    }

    pub fn is_circuit_breaker_active(env: Env) -> bool {
        is_circuit_breaker_active(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_data_source(env: Env, source: Address) -> Result<DataSource, Error> {
        ensure_initialized(&env)?;
        get_source(&env, &source).ok_or(Error::SourceNotFound)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn check_circuit_breaker(env: &Env) -> Result<(), Error> {
    if is_circuit_breaker_active(env) {
        return Err(Error::CircuitBreakerActive);
    }
    Ok(())
}
