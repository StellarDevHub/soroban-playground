// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Supply Chain Oracle Contract
//!
//! Full shipment lifecycle tracking with multi-source consensus, provenance
//! events, circuit breakers, and admin controls.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_prov_count, get_prov_event, get_shipment, get_shipment_count, get_source,
    get_threshold, is_circuit_breaker_active, is_initialized, is_paused, set_admin,
    set_circuit_breaker, set_initialized, set_paused, set_prov_count, set_prov_event,
    set_shipment, set_shipment_count, set_source, set_threshold, source_exists,
};
use crate::types::{DataSource, Error, ProvenanceEvent, Shipment, ShipmentStatus};

#[contract]
pub struct SupplyChainOracle;

#[contractimpl]
impl SupplyChainOracle {
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

    pub fn add_data_source(env: Env, admin: Address, source: Address, name: String) -> Result<(), Error> {
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

    /// Submit a new shipment. Returns the shipment ID.
    pub fn submit_logistics_data(
        env: Env,
        submitter: Address,
        shipment_ref: String,
        origin: String,
        destination: String,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        check_circuit_breaker(&env)?;
        submitter.require_auth();

        let mut ds = get_source(&env, &submitter).ok_or(Error::SourceNotFound)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }
        if shipment_ref.is_empty() {
            return Err(Error::InvalidShipmentRef);
        }

        let id = get_shipment_count(&env);
        let now = env.ledger().timestamp();
        let shipment = Shipment {
            id,
            shipment_ref,
            origin,
            destination,
            owner: submitter.clone(),
            status: ShipmentStatus::Created,
            created_at: now,
            updated_at: now,
            confirmations: 1,
        };
        set_shipment(&env, &shipment);
        set_shipment_count(&env, id + 1);

        ds.submissions += 1;
        set_source(&env, &ds);

        // Record initial provenance event
        record_provenance(&env, id, String::from_str(&env, "created"), origin_str(&env), now, submitter.clone());

        env.events().publish((symbol_short!("submit"),), (id, submitter));
        Ok(id)
    }

    /// Update shipment status and record a provenance event.
    pub fn get_logistics_data(env: Env, shipment_id: u32) -> Result<Shipment, Error> {
        ensure_initialized(&env)?;
        get_shipment(&env, shipment_id)
    }

    /// Confirm a shipment. Auto-verifies (→ Delivered) when threshold reached.
    pub fn confirm_shipment(
        env: Env,
        source: Address,
        shipment_id: u32,
        location: String,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        check_circuit_breaker(&env)?;
        source.require_auth();

        let ds = get_source(&env, &source).ok_or(Error::SourceNotFound)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }
        let mut shipment = get_shipment(&env, shipment_id)?;
        if shipment.status == ShipmentStatus::Finalized {
            return Err(Error::ShipmentAlreadyFinalized);
        }

        let now = env.ledger().timestamp();
        shipment.confirmations += 1;
        shipment.updated_at = now;

        if shipment.confirmations >= get_threshold(&env) {
            shipment.status = ShipmentStatus::Delivered;
            env.events().publish((symbol_short!("delivered"),), shipment_id);
        }
        set_shipment(&env, &shipment);

        record_provenance(&env, shipment_id, String::from_str(&env, "confirmed"), location, now, source);
        Ok(())
    }

    /// Update shipment status. Source only.
    pub fn update_status(
        env: Env,
        source: Address,
        shipment_id: u32,
        new_status: ShipmentStatus,
        location: String,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        check_circuit_breaker(&env)?;
        source.require_auth();

        let ds = get_source(&env, &source).ok_or(Error::SourceNotFound)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }
        let mut shipment = get_shipment(&env, shipment_id)?;
        if shipment.status == ShipmentStatus::Finalized {
            return Err(Error::ShipmentAlreadyFinalized);
        }
        // Prevent re-creating
        if new_status == ShipmentStatus::Created {
            return Err(Error::InvalidStatusTransition);
        }

        let now = env.ledger().timestamp();
        shipment.status = new_status;
        shipment.updated_at = now;
        set_shipment(&env, &shipment);

        record_provenance(&env, shipment_id, String::from_str(&env, "status_update"), location, now, source);
        env.events().publish((symbol_short!("statusUpd"),), shipment_id);
        Ok(())
    }

    /// Finalize a shipment. Admin only.
    pub fn finalize_shipment(env: Env, admin: Address, shipment_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut shipment = get_shipment(&env, shipment_id)?;
        if shipment.status == ShipmentStatus::Finalized {
            return Err(Error::ShipmentAlreadyFinalized);
        }
        shipment.status = ShipmentStatus::Finalized;
        shipment.updated_at = env.ledger().timestamp();
        set_shipment(&env, &shipment);
        env.events().publish((symbol_short!("final"),), shipment_id);
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

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_provenance_data(env: Env, shipment_id: u32, index: u32) -> Result<ProvenanceEvent, Error> {
        ensure_initialized(&env)?;
        get_prov_event(&env, shipment_id, index).ok_or(Error::ShipmentNotFound)
    }

    pub fn get_provenance_count(env: Env, shipment_id: u32) -> u32 {
        get_prov_count(&env, shipment_id)
    }

    pub fn get_shipment_count(env: Env) -> u32 {
        get_shipment_count(&env)
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

fn origin_str(env: &Env) -> String {
    String::from_str(env, "origin")
}

fn record_provenance(env: &Env, shipment_id: u32, event_type: String, location: String, timestamp: u64, recorder: Address) {
    let idx = get_prov_count(env, shipment_id);
    set_prov_event(env, &ProvenanceEvent { shipment_id, index: idx, event_type, location, timestamp, recorder });
    set_prov_count(env, shipment_id, idx + 1);
}
