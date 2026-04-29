// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Job Marketplace Contract
//!
//! A comprehensive job marketplace with escrow payment and skill verification.
//!
//! Features:
//! - Milestone-based escrow payments
//! - Skill verification and certification
//! - Dispute resolution mechanism
//! - Emergency pause functionality
//! - Comprehensive event emissions
//! - Role-based access control

#![no_std]

mod types;
mod storage;
mod events;
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};

use crate::types::{Error, Job, JobStatus, Milestone, Skill, Certification, Dispute};
use crate::storage::{
    get_job, set_job, get_job_count, set_job_count, get_skill, set_skill,
    get_certification, set_certification, get_dispute, set_dispute,
    get_dispute_count, set_dispute_count, is_paused, set_paused, get_admin,
    set_admin, has_skill, has_certification,
};
use crate::events::{
    emit_job_created, emit_job_accepted, emit_milestone_released, emit_job_completed,
    emit_job_cancelled, emit_dispute_raised, emit_dispute_resolved, emit_skill_verified,
    emit_certification_issued, emit_paused, emit_unpaused,
};

const TIMELOCK_SECS: u64 = 86_400; // 24 hours for dispute resolution

#[contract]
pub struct JobMarketplace;

#[contractimpl]
impl JobMarketplace {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if get_admin(&env).is_some() {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    // ── Job Management ────────────────────────────────────────────────────────

    /// Create a new job with escrow payment
    pub fn create_job(
        env: Env,
        client: Address,
        title: String,
        description: String,
        payment_token: Address,
        total_escrow: i128,
        milestones: Vec<Milestone>,
        required_skills: Vec<Symbol>,
    ) -> Result<u64, Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        client.require_auth();

        if title.is_empty() || description.is_empty() {
            return Err(Error::EmptyField);
        }

        if total_escrow <= 0 {
            return Err(Error::InvalidEscrowAmount);
        }

        // Verify milestones sum equals total_escrow
        let mut milestone_sum: i128 = 0;
        for i in 0..milestones.len() {
            milestone_sum += milestones.get(i).unwrap().amount;
        }
        if milestone_sum != total_escrow {
            return Err(Error::MilestoneSumMismatch);
        }

        // Transfer escrow amount from client to contract
        let token_client = token::Client::new(&env, &payment_token);
        token_client.transfer(&client, &env.current_contract_address(), &total_escrow);

        let id = get_job_count(&env) + 1;
        let now = env.ledger().timestamp();

        let job = Job {
            id,
            client: client.clone(),
            freelancer: None,
            payment_token,
            total_escrow,
            released_amount: 0,
            status: JobStatus::Open,
            milestones,
            required_skills,
            created_at: now,
            accepted_at: None,
            completed_at: None,
        };

        set_job(&env, id, &job);
        set_job_count(&env, id);

        emit_job_created(&env, id, &client, &payment_token, total_escrow);

        Ok(id)
    }

    /// Accept a job as a freelancer
    pub fn accept_job(env: Env, freelancer: Address, job_id: u64) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        freelancer.require_auth();

        let mut job = get_job(&env, job_id).ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::Open {
            return Err(Error::JobNotOpen);
        }

        if job.client == freelancer {
            return Err(Error::ClientCannotBeFreelancer);
        }

        // Verify freelancer has required skills
        for i in 0..job.required_skills.len() {
            let skill = job.required_skills.get(i).unwrap();
            if !has_skill(&env, &freelancer, &skill) {
                return Err(Error::SkillNotVerified);
            }
        }

        job.freelancer = Some(freelancer.clone());
        job.status = JobStatus::InProgress;
        job.accepted_at = Some(env.ledger().timestamp());

        set_job(&env, job_id, &job);

        emit_job_accepted(&env, job_id, &freelancer);

        Ok(())
    }

    /// Release milestone payment to freelancer
    pub fn release_milestone(env: Env, client: Address, job_id: u64, milestone_index: u32) -> Result<(), Error> {
        client.require_auth();

        let mut job = get_job(&env, job_id).ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::InProgress {
            return Err(Error::JobNotInProgress);
        }

        if job.client != client {
            return Err(Error::Unauthorized);
        }

        if milestone_index >= job.milestones.len() as u32 {
            return Err(Error::InvalidMilestoneIndex);
        }

        let milestone = job.milestones.get(milestone_index as u32).unwrap();
        if milestone.is_released {
            return Err(Error::MilestoneAlreadyReleased);
        }

        // Transfer milestone payment to freelancer
        let token_client = token::Client::new(&env, &job.payment_token);
        let freelancer_addr = job.freelancer.as_ref().ok_or(Error::FreelancerNotFound)?;
        token_client.transfer(&env.current_contract_address(), freelancer_addr, &milestone.amount);

        job.released_amount += milestone.amount;
        job.milestones.get_mut(milestone_index as u32).unwrap().is_released = true;

        // Check if all milestones are released
        let all_released = job.milestones.iter().all(|m| m.is_released);
        if all_released {
            job.status = JobStatus::Completed;
            job.completed_at = Some(env.ledger().timestamp());
            emit_job_completed(&env, job_id, freelancer_addr, job.released_amount);
        }

        set_job(&env, job_id, &job);

        emit_milestone_released(&env, job_id, freelancer_addr, milestone.amount, milestone_index);

        Ok(())
    }

    /// Cancel an open job and refund escrow
    pub fn cancel_job(env: Env, client: Address, job_id: u64) -> Result<(), Error> {
        client.require_auth();

        let mut job = get_job(&env, job_id).ok_or(Error::JobNotFound)?;

        if job.client != client {
            return Err(Error::Unauthorized);
        }

        if job.status != JobStatus::Open {
            return Err(Error::CannotCancelJob);
        }

        // Refund full escrow amount to client
        let token_client = token::Client::new(&env, &job.payment_token);
        token_client.transfer(&env.current_contract_address(), &client, &job.total_escrow);

        job.status = JobStatus::Cancelled;
        set_job(&env, job_id, &job);

        emit_job_cancelled(&env, job_id, &client, job.total_escrow);

        Ok(())
    }

    // ── Skill Verification ────────────────────────────────────────────────────

    /// Register a skill for a user (admin or oracle only)
    pub fn verify_skill(
        env: Env,
        caller: Address,
        user: Address,
        skill: Symbol,
        level: u32,
    ) -> Result<(), Error> {
        caller.require_auth();

        // Only admin or authorized oracle can verify skills
        if get_admin(&env) != Some(caller) {
            return Err(Error::Unauthorized);
        }

        if level < 1 || level > 5 {
            return Err(Error::InvalidSkillLevel);
        }

        let skill_record = Skill {
            user: user.clone(),
            skill: skill.clone(),
            level,
            verified_at: env.ledger().timestamp(),
            verified_by: caller,
        };

        set_skill(&env, &user, &skill, &skill_record);

        emit_skill_verified(&env, &user, &skill, level);

        Ok(())
    }

    /// Get user's verified skills
    pub fn get_user_skills(env: Env, user: Address) -> Vec<Skill> {
        let mut skills = Vec::new(&env);
        // This would iterate through all skills for the user
        // Implementation depends on storage structure
        skills
    }

    // ── Certification ─────────────────────────────────────────────────────────

    /// Issue a certification to a user
    pub fn issue_certification(
        env: Env,
        caller: Address,
        user: Address,
        certification_name: String,
        issuer: String,
        valid_until: u64,
    ) -> Result<(), Error> {
        caller.require_auth();

        if get_admin(&env) != Some(caller) {
            return Err(Error::Unauthorized);
        }

        if certification_name.is_empty() || issuer.is_empty() {
            return Err(Error::EmptyField);
        }

        let now = env.ledger().timestamp();
        if valid_until <= now {
            return Err(Error::InvalidValidityPeriod);
        }

        let cert = Certification {
            user: user.clone(),
            name: certification_name.clone(),
            issuer: issuer.clone(),
            issued_at: now,
            valid_until,
        };

        set_certification(&env, &user, &certification_name, &cert);

        emit_certification_issued(&env, &user, &certification_name, &issuer, valid_until);

        Ok(())
    }

    // ── Dispute Resolution ────────────────────────────────────────────────────

    /// Raise a dispute on a job
    pub fn raise_dispute(
        env: Env,
        caller: Address,
        job_id: u64,
        reason: String,
    ) -> Result<u64, Error> {
        caller.require_auth();

        let mut job = get_job(&env, job_id).ok_or(Error::JobNotFound)?;

        if job.status != JobStatus::InProgress {
            return Err(Error::JobNotInProgress);
        }

        if job.client != caller && job.freelancer != Some(caller.clone()) {
            return Err(Error::Unauthorized);
        }

        if reason.is_empty() {
            return Err(Error::EmptyField);
        }

        job.status = JobStatus::Disputed;
        set_job(&env, job_id, &job);

        let dispute_id = get_dispute_count(&env) + 1;
        let dispute = Dispute {
            id: dispute_id,
            job_id,
            raised_by: caller.clone(),
            reason: reason.clone(),
            created_at: env.ledger().timestamp(),
            resolved_at: None,
            resolution: None,
            resolved_by: None,
        };

        set_dispute(&env, dispute_id, &dispute);
        set_dispute_count(&env, dispute_id);

        emit_dispute_raised(&env, dispute_id, job_id, &caller, &reason);

        Ok(dispute_id)
    }

    /// Resolve a dispute (admin only)
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        dispute_id: u64,
        refund_client: i128,
        release_to_freelancer: i128,
    ) -> Result<(), Error> {
        admin.require_auth();

        if get_admin(&env) != Some(admin.clone()) {
            return Err(Error::Unauthorized);
        }

        let mut dispute = get_dispute(&env, dispute_id).ok_or(Error::DisputeNotFound)?;

        if dispute.resolved_at.is_some() {
            return Err(Error::DisputeAlreadyResolved);
        }

        let job = get_job(&env, dispute.job_id).ok_or(Error::JobNotFound)?;
        let remaining_escrow = job.total_escrow - job.released_amount;

        if refund_client + release_to_freelancer > remaining_escrow {
            return Err(Error::InvalidRefundAmount);
        }

        // Process refunds
        let token_client = token::Client::new(&env, &job.payment_token);
        
        if refund_client > 0 {
            token_client.transfer(&env.current_contract_address(), &job.client, &refund_client);
        }

        if release_to_freelancer > 0 {
            if let Some(freelancer) = &job.freelancer {
                token_client.transfer(&env.current_contract_address(), freelancer, &release_to_freelancer);
            }
        }

        // Update job status
        let mut updated_job = job;
        updated_job.status = if release_to_freelancer > 0 {
            JobStatus::Completed
        } else {
            JobStatus::Cancelled
        };
        updated_job.completed_at = Some(env.ledger().timestamp());
        set_job(&env, dispute.job_id, &updated_job);

        // Update dispute
        dispute.resolved_at = Some(env.ledger().timestamp());
        dispute.resolution = Some(String::from_str(&env, "Resolved by admin"));
        dispute.resolved_by = Some(admin.clone());
        set_dispute(&env, dispute_id, &dispute);

        emit_dispute_resolved(&env, dispute_id, dispute.job_id, &admin, refund_client, release_to_freelancer);

        Ok(())
    }

    // ── Admin Functions ───────────────────────────────────────────────────────

    /// Pause the contract (emergency stop)
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        
        if get_admin(&env) != Some(admin.clone()) {
            return Err(Error::Unauthorized);
        }

        set_paused(&env, true);
        emit_paused(&env, &admin);

        Ok(())
    }

    /// Unpause the contract
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        
        if get_admin(&env) != Some(admin.clone()) {
            return Err(Error::Unauthorized);
        }

        set_paused(&env, false);
        emit_unpaused(&env, &admin);

        Ok(())
    }

    /// Transfer admin rights
    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), Error> {
        current_admin.require_auth();
        
        if get_admin(&env) != Some(current_admin) {
            return Err(Error::Unauthorized);
        }

        set_admin(&env, &new_admin);

        Ok(())
    }

    // ── Query Functions ───────────────────────────────────────────────────────

    pub fn get_job(env: Env, job_id: u64) -> Result<Job, Error> {
        get_job(&env, job_id).ok_or(Error::JobNotFound)
    }

    pub fn get_job_count(env: Env) -> u64 {
        get_job_count(&env)
    }

    pub fn is_contract_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        get_admin(&env)
    }

    pub fn get_dispute(env: Env, dispute_id: u64) -> Result<Dispute, Error> {
        get_dispute(&env, dispute_id).ok_or(Error::DisputeNotFound)
    }

    pub fn get_certification(env: Env, user: Address, name: String) -> Result<Certification, Error> {
        get_certification(&env, &user, &name).ok_or(Error::CertificationNotFound)
    }
}
