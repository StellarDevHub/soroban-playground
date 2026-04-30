// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Patent Registry
//!
//! A Soroban smart contract providing:
//! - Patent filing: inventors register patents with title, description, and expiry.
//! - Patent management: admin can approve (activate), revoke, or expire patents.
//! - Licensing: patent owners grant licenses (exclusive/non-exclusive) with fees.
//! - Transfers: patent owners can transfer ownership to another address.
//! - Disputes: anyone can file a dispute; admin resolves it.
//! - Emergency pause: admin can pause/unpause all state-changing operations.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_dispute, get_dispute_count, get_license, get_license_count, get_patent,
    get_patent_count, is_initialized, is_paused, next_dispute_id, next_license_id, next_patent_id,
    set_admin, set_dispute, set_license, set_patent, set_paused,
};
use crate::types::{
    Dispute, DisputeStatus, Error, License, LicenseType, Patent, PatentStatus,
};

#[contract]
pub struct PatentRegistryContract;

#[contractimpl]
impl PatentRegistryContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the registry with an admin address. Can only be called once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_paused(&env, false);
        Ok(())
    }

    // ── Admin helpers ─────────────────────────────────────────────────────────

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) {
            return Err(Error::Paused);
        }
        Ok(())
    }

    // ── Emergency pause ───────────────────────────────────────────────────────

    /// Pause all state-changing operations (admin only).
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), true);
        Ok(())
    }

    /// Resume operations (admin only).
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("paused"),), false);
        Ok(())
    }

    // ── Patent filing ─────────────────────────────────────────────────────────

    /// File a new patent. Returns the patent ID.
    /// Status starts as `Pending` until admin activates it.
    pub fn file_patent(
        env: Env,
        inventor: Address,
        title: String,
        description: String,
        expiry_date: u64,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        inventor.require_auth();

        if title.len() == 0 {
            return Err(Error::EmptyField);
        }
        if description.len() == 0 {
            return Err(Error::EmptyField);
        }

        let now = env.ledger().timestamp();
        let id = next_patent_id(&env);
        let patent = Patent {
            title,
            description,
            owner: inventor.clone(),
            filing_date: now,
            expiry_date,
            status: PatentStatus::Pending,
            license_count: 0,
        };
        set_patent(&env, id, &patent);

        env.events()
            .publish((symbol_short!("filed"), inventor), id);

        Ok(id)
    }

    /// Activate a pending patent (admin only).
    pub fn activate_patent(env: Env, admin: Address, patent_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_admin(&env, &admin)?;

        let mut patent = get_patent(&env, patent_id)?;
        if patent.status != PatentStatus::Pending {
            return Err(Error::InvalidStatus);
        }
        patent.status = PatentStatus::Active;
        set_patent(&env, patent_id, &patent);

        env.events()
            .publish((symbol_short!("activated"),), patent_id);

        Ok(())
    }

    /// Revoke an active patent (admin only).
    pub fn revoke_patent(env: Env, admin: Address, patent_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_admin(&env, &admin)?;

        let mut patent = get_patent(&env, patent_id)?;
        if patent.status != PatentStatus::Active {
            return Err(Error::InvalidStatus);
        }
        patent.status = PatentStatus::Revoked;
        set_patent(&env, patent_id, &patent);

        env.events()
            .publish((symbol_short!("revoked"),), patent_id);

        Ok(())
    }

    // ── Ownership transfer ────────────────────────────────────────────────────

    /// Transfer patent ownership to a new address (current owner only).
    pub fn transfer_patent(
        env: Env,
        owner: Address,
        patent_id: u32,
        new_owner: Address,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        owner.require_auth();

        let mut patent = get_patent(&env, patent_id)?;
        if patent.owner != owner {
            return Err(Error::NotOwner);
        }
        if patent.status != PatentStatus::Active {
            return Err(Error::InvalidStatus);
        }

        patent.owner = new_owner.clone();
        set_patent(&env, patent_id, &patent);

        env.events()
            .publish((symbol_short!("transfer"), patent_id), new_owner);

        Ok(())
    }

    // ── Licensing ─────────────────────────────────────────────────────────────

    /// Grant a license on an active patent. Returns the license ID.
    pub fn grant_license(
        env: Env,
        owner: Address,
        patent_id: u32,
        licensee: Address,
        license_type: LicenseType,
        fee: i128,
        expiry_date: u64,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        owner.require_auth();

        if fee < 0 {
            return Err(Error::InvalidFee);
        }

        let mut patent = get_patent(&env, patent_id)?;
        if patent.owner != owner {
            return Err(Error::NotOwner);
        }
        if patent.status != PatentStatus::Active {
            return Err(Error::InvalidStatus);
        }

        let now = env.ledger().timestamp();
        let license_id = next_license_id(&env);
        let license = License {
            patent_id,
            licensee: licensee.clone(),
            license_type,
            fee,
            expiry_date,
            granted_date: now,
        };
        set_license(&env, license_id, &license);

        patent.license_count += 1;
        set_patent(&env, patent_id, &patent);

        env.events()
            .publish((symbol_short!("licensed"), patent_id), license_id);

        Ok(license_id)
    }

    // ── Disputes ──────────────────────────────────────────────────────────────

    /// File a dispute against a patent. Returns the dispute ID.
    pub fn file_dispute(
        env: Env,
        claimant: Address,
        patent_id: u32,
        reason: String,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        claimant.require_auth();

        // Patent must exist
        get_patent(&env, patent_id)?;

        if reason.len() == 0 {
            return Err(Error::EmptyField);
        }

        let now = env.ledger().timestamp();
        let dispute_id = next_dispute_id(&env);
        let dispute = Dispute {
            patent_id,
            claimant: claimant.clone(),
            reason,
            filed_date: now,
            status: DisputeStatus::Open,
            resolution: String::from_str(&env, ""),
        };
        set_dispute(&env, dispute_id, &dispute);

        env.events()
            .publish((symbol_short!("dispute"), patent_id), dispute_id);

        Ok(dispute_id)
    }

    /// Resolve a dispute (admin only).
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        dispute_id: u32,
        resolution: String,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_admin(&env, &admin)?;

        let mut dispute = get_dispute(&env, dispute_id)?;
        if dispute.status == DisputeStatus::Resolved {
            return Err(Error::DisputeAlreadyResolved);
        }
        if resolution.len() == 0 {
            return Err(Error::EmptyField);
        }

        dispute.status = DisputeStatus::Resolved;
        dispute.resolution = resolution;
        set_dispute(&env, dispute_id, &dispute);

        env.events()
            .publish((symbol_short!("resolved"),), dispute_id);

        Ok(())
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_patent(env: Env, patent_id: u32) -> Result<Patent, Error> {
        get_patent(&env, patent_id)
    }

    pub fn get_license(env: Env, license_id: u32) -> Result<License, Error> {
        get_license(&env, license_id)
    }

    pub fn get_dispute(env: Env, dispute_id: u32) -> Result<Dispute, Error> {
        get_dispute(&env, dispute_id)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_patent_count(env: Env) -> u32 {
        get_patent_count(&env)
    }

    pub fn get_license_count(env: Env) -> u32 {
        get_license_count(&env)
    }

    pub fn get_dispute_count(env: Env) -> u32 {
        get_dispute_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}
