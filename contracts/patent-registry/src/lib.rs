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
//! - Milestone Escrow: escrow agreements with milestone-based payment releases.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, BytesN};

use crate::storage::{
    get_admin, get_dispute, get_dispute_count, get_escrow, get_escrow_count, get_license,
    get_license_count, get_milestone, get_milestone_count, get_patent, get_patent_count,
    is_initialized, is_paused, next_dispute_id, next_escrow_id, next_license_id, next_milestone_id,
    next_patent_id, set_admin, set_dispute, set_escrow, set_license, set_milestone, set_patent,
    set_paused,
};
use crate::types::{
    Dispute, DisputeStatus, Error, Escrow, EscrowStatus, License, LicenseType, Milestone,
    MilestoneStatus, Patent, PatentStatus,
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
        doc_hash: BytesN<32>,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        inventor.require_auth();

        if title.len() == 0 {
            return Err(Error::EmptyField);
        }
        if description.len() == 0 {
            return Err(Error::EmptyField);
        }
        // Ensure hash uniqueness
        if has_patent_hash(&env, &doc_hash) {
            return Err(Error::AlreadyExists);
        }

        let now = env.ledger().timestamp();
        let seq = env.ledger().sequence();
        let id = next_patent_id(&env);
        let patent = Patent {
            title,
            description,
            owner: inventor.clone(),
            filing_date: now,
            ledger_seq: seq,
            expiry_date,
            status: PatentStatus::Pending,
            license_count: 0,
            doc_hash,
        };
        set_patent(&env, id, &patent);
        // Record hash to prevent duplicates
        set_patent_hash(&env, &patent.doc_hash);

        env.events().publish((symbol_short!("filed"), inventor), id);

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

        env.events().publish((symbol_short!("revoked"),), patent_id);

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

    // ── Escrow with Milestones ────────────────────────────────────────────────

    /// Create an escrow agreement for a patent license. Returns the escrow ID.
    pub fn create_escrow(
        env: Env,
        payer: Address,
        patent_id: u32,
        license_id: u32,
        total_amount: i128,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        payer.require_auth();

        if total_amount <= 0 {
            return Err(Error::InvalidFee);
        }

        // Verify patent and license exist
        let patent = get_patent(&env, patent_id)?;
        let license = get_license(&env, license_id)?;

        // Verify payer is the licensee
        if license.licensee != payer {
            return Err(Error::Unauthorized);
        }

        // Verify patent is active
        if patent.status != PatentStatus::Active {
            return Err(Error::InvalidStatus);
        }

        let now = env.ledger().timestamp();
        let escrow_id = next_escrow_id(&env);
        let escrow = Escrow {
            id: escrow_id,
            patent_id,
            license_id,
            payer: payer.clone(),
            payee: patent.owner,
            total_amount,
            deposited_amount: 0,
            released_amount: 0,
            status: EscrowStatus::Funded,
            created_at: now,
            milestone_count: 0,
        };
        set_escrow(&env, escrow_id, &escrow);

        env.events()
            .publish((symbol_short!("escrow"), patent_id), escrow_id);

        Ok(escrow_id)
    }

    /// Fund an escrow by depositing the full amount.
    pub fn fund_escrow(env: Env, payer: Address, escrow_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        payer.require_auth();

        let mut escrow = get_escrow(&env, escrow_id)?;
        if escrow.payer != payer {
            return Err(Error::Unauthorized);
        }

        let remaining = escrow.total_amount - escrow.deposited_amount;
        if remaining <= 0 {
            return Err(Error::AlreadyExists);
        }

        // In a real contract, this would transfer tokens via the token contract
        // For now, we just update the accounting
        escrow.deposited_amount = escrow.total_amount;
        set_escrow(&env, escrow_id, &escrow);

        env.events().publish((symbol_short!("funded"),), escrow_id);

        Ok(())
    }

    /// Add a milestone to an escrow. Returns the milestone ID.
    pub fn add_milestone(
        env: Env,
        owner: Address,
        escrow_id: u32,
        description: String,
        amount: i128,
        due_date: u64,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        owner.require_auth();

        if description.len() == 0 {
            return Err(Error::EmptyField);
        }
        if amount <= 0 {
            return Err(Error::InvalidFee);
        }

        let mut escrow = get_escrow(&env, escrow_id)?;
        if escrow.payee != owner {
            return Err(Error::Unauthorized);
        }

        // Verify total milestones don't exceed escrow amount
        let total_milestone_amount = Self::get_total_milestone_amount(&env, escrow_id) + amount;
        if total_milestone_amount > escrow.total_amount {
            return Err(Error::InsufficientDeposit);
        }

        let _now = env.ledger().timestamp();
        let milestone_id = next_milestone_id(&env);
        let milestone = Milestone {
            id: milestone_id,
            escrow_id,
            description,
            amount,
            status: MilestoneStatus::Pending,
            due_date,
            completed_at: None,
            verified_at: None,
        };
        set_milestone(&env, milestone_id, &milestone);

        escrow.milestone_count += 1;
        set_escrow(&env, escrow_id, &escrow);

        env.events()
            .publish((symbol_short!("milestone"), escrow_id), milestone_id);

        Ok(milestone_id)
    }

    /// Complete a milestone (payer confirms delivery).
    pub fn complete_milestone(env: Env, payer: Address, milestone_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        payer.require_auth();

        let mut milestone = get_milestone(&env, milestone_id)?;
        let escrow = get_escrow(&env, milestone.escrow_id)?;

        if escrow.payer != payer {
            return Err(Error::Unauthorized);
        }

        if milestone.status != MilestoneStatus::Pending {
            return Err(Error::InvalidMilestoneStatus);
        }

        let now = env.ledger().timestamp();
        milestone.status = MilestoneStatus::Completed;
        milestone.completed_at = Some(now);
        set_milestone(&env, milestone_id, &milestone);

        env.events()
            .publish((symbol_short!("complete"),), milestone_id);

        Ok(())
    }

    /// Verify a milestone and release payment (payee confirms and receives funds).
    pub fn verify_and_release(env: Env, payee: Address, milestone_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        payee.require_auth();

        let mut milestone = get_milestone(&env, milestone_id)?;
        let mut escrow = get_escrow(&env, milestone.escrow_id)?;

        if escrow.payee != payee {
            return Err(Error::Unauthorized);
        }

        if milestone.status != MilestoneStatus::Completed {
            return Err(Error::InvalidMilestoneStatus);
        }

        let now = env.ledger().timestamp();
        milestone.status = MilestoneStatus::Verified;
        milestone.verified_at = Some(now);
        set_milestone(&env, milestone_id, &milestone);

        // Release payment
        escrow.released_amount += milestone.amount;
        if escrow.released_amount >= escrow.total_amount {
            escrow.status = EscrowStatus::FullyReleased;
        } else {
            escrow.status = EscrowStatus::PartiallyReleased;
        }
        set_escrow(&env, milestone.escrow_id, &escrow);

        env.events()
            .publish((symbol_short!("release"),), milestone_id);

        Ok(())
    }

    /// Reject a milestone (payee rejects delivery).
    pub fn reject_milestone(env: Env, payee: Address, milestone_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        payee.require_auth();

        let mut milestone = get_milestone(&env, milestone_id)?;
        let escrow = get_escrow(&env, milestone.escrow_id)?;

        if escrow.payee != payee {
            return Err(Error::Unauthorized);
        }

        if milestone.status != MilestoneStatus::Completed {
            return Err(Error::InvalidMilestoneStatus);
        }

        milestone.status = MilestoneStatus::Rejected;
        set_milestone(&env, milestone_id, &milestone);

        env.events()
            .publish((symbol_short!("reject"),), milestone_id);

        Ok(())
    }

    /// Refund the remaining balance to the payer (admin only, for dispute resolution).
    pub fn refund_escrow(env: Env, admin: Address, escrow_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_admin(&env, &admin)?;

        let mut escrow = get_escrow(&env, escrow_id)?;

        if escrow.status == EscrowStatus::FullyReleased || escrow.status == EscrowStatus::Refunded {
            return Err(Error::EscrowAlreadyReleased);
        }

        let refund_amount = escrow.deposited_amount - escrow.released_amount;
        escrow.released_amount += refund_amount;
        escrow.status = EscrowStatus::Refunded;
        set_escrow(&env, escrow_id, &escrow);

        env.events()
            .publish((symbol_short!("refund"),), (escrow_id, refund_amount));

        Ok(())
    }

    /// Helper to calculate total milestone amounts for an escrow.
    fn get_total_milestone_amount(env: &Env, escrow_id: u32) -> i128 {
        let escrow = get_escrow(env, escrow_id).unwrap_or_else(|_| panic!("escrow not found"));
        let mut total = 0i128;
        for i in 1..=escrow.milestone_count {
            if let Ok(m) = get_milestone(env, escrow_id * 10000 + i) {
                total += m.amount;
            }
        }
        total
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

    pub fn get_escrow(env: Env, escrow_id: u32) -> Result<Escrow, Error> {
        get_escrow(&env, escrow_id)
    }

    pub fn get_milestone(env: Env, milestone_id: u32) -> Result<Milestone, Error> {
        get_milestone(&env, milestone_id)
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

    pub fn get_escrow_count(env: Env) -> u32 {
        get_escrow_count(&env)
    }

    pub fn get_milestone_count(env: Env) -> u32 {
        get_milestone_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}
