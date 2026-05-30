// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Supply Chain Data Oracle Contract
//!
//! Provides tamper-resistant logistics data for Soroban applications.
//! Supports IoT sensor data, multi-source verification, provenance tracking,
//! and circuit breakers.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_data_count, get_logistics_data, get_provenance_count, get_provenance_record,
    get_source, get_threshold, is_circuit_breaker_active, is_initialized, is_paused, set_admin,
    set_circuit_breaker, set_data_count, set_initialized, set_logistics_data, set_paused,
    set_provenance_count, set_provenance_record, set_source, set_threshold, source_exists,
};
use crate::types::{DataSource, Error, LogisticsData, LogisticsStatus, ProvenanceRecord};

#[contract]
pub struct SupplyChainDataOracle;

#[contractimpl]
impl SupplyChainDataOracle {
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
        set_source(&env, &DataSource { address: source.clone(), name, active: true, submissions: 0 });
        env.events().publish((symbol_short!("srcAdd"),), source);
        Ok(())
    }

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

    pub fn set_verification_threshold(env: Env, admin: Address, threshold: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        set_threshold(&env, threshold);
        Ok(())
    }

    pub fn submit_logistics_data(
        env: Env,
        submitter: Address,
        shipment_id: String,
        origin: String,
        destination: String,
        carrier: String,
        status: LogisticsStatus,
        temperature: i32,
        humidity: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        check_circuit_breaker(&env)?;
        submitter.require_auth();

        let mut ds = get_source(&env, &submitter).ok_or(Error::SourceNotFound)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }
        if shipment_id.is_empty() {
            return Err(Error::InvalidShipmentId);
        }
        if humidity > 100 {
            return Err(Error::InvalidHumidity);
        }

        let id = get_data_count(&env);
        let now = env.ledger().timestamp();
        let data = LogisticsData {
            id,
            shipment_id: shipment_id.clone(),
            origin,
            destination,
            carrier,
            status,
            timestamp: now,
            submitter: submitter.clone(),
            confirmations: 1,
            temperature,
            humidity,
        };
        set_logistics_data(&env, &data);
        set_data_count(&env, id + 1);

        ds.submissions += 1;
        set_source(&env, &ds);

        let prov_idx = get_provenance_count(&env, &shipment_id);
        set_provenance_record(
            &env,
            &ProvenanceRecord {
                shipment_id: shipment_id.clone(),
                data_id: id,
                event: String::from_str(&env, "submitted"),
                timestamp: now,
                recorder: submitter.clone(),
            },
            prov_idx,
        );
        set_provenance_count(&env, &shipment_id, prov_idx + 1);

        env.events().publish((symbol_short!("submit"),), (id, submitter));
        Ok(id)
    }

    pub fn confirm_logistics_data(env: Env, source: Address, data_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        check_circuit_breaker(&env)?;
        source.require_auth();

        let ds = get_source(&env, &source).ok_or(Error::SourceNotFound)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }
        let mut data = get_logistics_data(&env, data_id)?;
        if data.status == LogisticsStatus::Finalized {
            return Err(Error::DataAlreadyFinalized);
        }
        data.confirmations += 1;
        if data.confirmations >= get_threshold(&env) {
            data.status = LogisticsStatus::Verified;
            env.events().publish((symbol_short!("verified"),), data_id);
        }
        set_logistics_data(&env, &data);
        Ok(())
    }

    pub fn finalize_logistics_data(env: Env, admin: Address, data_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut data = get_logistics_data(&env, data_id)?;
        if data.status == LogisticsStatus::Finalized {
            return Err(Error::DataAlreadyFinalized);
        }
        data.status = LogisticsStatus::Finalized;
        set_logistics_data(&env, &data);
        env.events().publish((symbol_short!("final"),), data_id);
        Ok(())
    }

    pub fn set_circuit_breaker(env: Env, admin: Address, active: bool) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_circuit_breaker(&env, active);
        env.events().publish((symbol_short!("cb"),), active);
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        Ok(())
    }

    pub fn get_logistics_data(env: Env, data_id: u32) -> Result<LogisticsData, Error> {
        ensure_initialized(&env)?;
        get_logistics_data(&env, data_id)
    }

    pub fn get_provenance_data(env: Env, shipment_id: String, index: u32) -> Result<ProvenanceRecord, Error> {
        ensure_initialized(&env)?;
        get_provenance_record(&env, &shipment_id, index).ok_or(Error::DataNotFound)
    }

    pub fn get_provenance_count(env: Env, shipment_id: String) -> u32 {
        get_provenance_count(&env, &shipment_id)
    }

    pub fn get_data_count(env: Env) -> u32 {
        get_data_count(&env)
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

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) { Err(Error::NotInitialized) } else { Ok(()) }
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) { Err(Error::ContractPaused) } else { Ok(()) }
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller { Err(Error::Unauthorized) } else { Ok(()) }
}

fn check_circuit_breaker(env: &Env) -> Result<(), Error> {
    if is_circuit_breaker_active(env) { Err(Error::CircuitBreakerActive) } else { Ok(()) }
}
