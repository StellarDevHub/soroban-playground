#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, Vec};

use crate::storage::{get_admin, get_count, is_initialized, load_schedule, next_id, save_schedule, set_admin};
use crate::types::{Error, Milestone, VestingSchedule, VestingType};

#[contract]
pub struct TokenVesting;

#[contractimpl]
impl TokenVesting {
    /// Initialize with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    /// Create a linear vesting schedule.
    /// Caller must have approved `total_amount` tokens to this contract.
    pub fn create_linear_schedule(
        env: Env,
        creator: Address,
        beneficiary: Address,
        token: Address,
        total_amount: i128,
        cliff_timestamp: u64,
        start_timestamp: u64,
        end_timestamp: u64,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        creator.require_auth();

        if total_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if cliff_timestamp < start_timestamp || end_timestamp <= cliff_timestamp {
            return Err(Error::InvalidSchedule);
        }

        // Pull tokens from creator into this contract
        let client = token::Client::new(&env, &token);
        client.transfer(&creator, &env.current_contract_address(), &total_amount);

        let id = next_id(&env);
        let schedule = VestingSchedule {
            id,
            beneficiary,
            token,
            total_amount,
            released_amount: 0,
            cliff_timestamp,
            start_timestamp,
            end_timestamp,
            vesting_type: VestingType::Linear,
            milestones: Vec::new(&env),
            revoked: false,
            created_at: env.ledger().timestamp(),
        };
        save_schedule(&env, &schedule);
        Ok(id)
    }

    /// Create a milestone-based vesting schedule.
    /// `milestone_bps` is a list of basis-point allocations (must sum to 10000).
    /// `milestone_hashes` are u64 hashes of milestone descriptions.
    pub fn create_milestone_schedule(
        env: Env,
        creator: Address,
        beneficiary: Address,
        token: Address,
        total_amount: i128,
        cliff_timestamp: u64,
        milestone_hashes: Vec<u64>,
        milestone_bps: Vec<u32>,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        creator.require_auth();

        if total_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if milestone_hashes.len() != milestone_bps.len() || milestone_hashes.is_empty() {
            return Err(Error::InvalidSchedule);
        }

        // Validate bps sum to 10000
        let total_bps: u32 = milestone_bps.iter().sum();
        if total_bps != 10_000 {
            return Err(Error::InvalidSchedule);
        }

        let client = token::Client::new(&env, &token);
        client.transfer(&creator, &env.current_contract_address(), &total_amount);

        let mut milestones: Vec<Milestone> = Vec::new(&env);
        for i in 0..milestone_hashes.len() {
            milestones.push_back(Milestone {
                description_hash: milestone_hashes.get(i).unwrap(),
                pct_bps: milestone_bps.get(i).unwrap(),
                approved: false,
            });
        }

        let id = next_id(&env);
        let schedule = VestingSchedule {
            id,
            beneficiary,
            token,
            total_amount,
            released_amount: 0,
            cliff_timestamp,
            start_timestamp: cliff_timestamp,
            end_timestamp: cliff_timestamp, // unused for milestone type
            vesting_type: VestingType::Milestone,
            milestones,
            revoked: false,
            created_at: env.ledger().timestamp(),
        };
        save_schedule(&env, &schedule);
        Ok(id)
    }

    /// Admin approves a milestone, unlocking its token allocation.
    pub fn approve_milestone(env: Env, schedule_id: u32, milestone_index: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut schedule = load_schedule(&env, schedule_id)?;
        if schedule.revoked {
            return Err(Error::ScheduleRevoked);
        }
        if schedule.vesting_type != VestingType::Milestone {
            return Err(Error::InvalidSchedule);
        }

        let idx = milestone_index as usize;
        if idx >= schedule.milestones.len() as usize {
            return Err(Error::MilestoneNotFound);
        }

        let mut m = schedule.milestones.get(milestone_index).unwrap();
        if m.approved {
            return Err(Error::MilestoneAlreadyApproved);
        }
        m.approved = true;
        schedule.milestones.set(milestone_index, m);
        save_schedule(&env, &schedule);
        Ok(())
    }

    /// Release vested tokens to the beneficiary.
    /// For linear: releases all currently vested tokens.
    /// For milestone: releases all approved-but-unreleased milestone allocations.
    pub fn release(env: Env, schedule_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;

        let mut schedule = load_schedule(&env, schedule_id)?;
        if schedule.revoked {
            return Err(Error::ScheduleRevoked);
        }

        let now = env.ledger().timestamp();
        if now < schedule.cliff_timestamp {
            return Err(Error::CliffNotReached);
        }

        let releasable = match schedule.vesting_type {
            VestingType::Linear => compute_linear_releasable(&schedule, now),
            VestingType::Milestone => compute_milestone_releasable(&schedule),
        };

        if releasable == 0 {
            return Err(Error::NothingToRelease);
        }

        schedule.released_amount += releasable;
        save_schedule(&env, &schedule);

        let client = token::Client::new(&env, &schedule.token);
        client.transfer(&env.current_contract_address(), &schedule.beneficiary, &releasable);

        Ok(releasable)
    }

    /// Admin revokes a schedule, returning unvested tokens to the admin.
    pub fn revoke(env: Env, schedule_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut schedule = load_schedule(&env, schedule_id)?;
        if schedule.revoked {
            return Err(Error::AlreadyRevoked);
        }

        let now = env.ledger().timestamp();
        // Release any vested amount to beneficiary first
        let vested = match schedule.vesting_type {
            VestingType::Linear => compute_linear_vested(&schedule, now),
            VestingType::Milestone => compute_milestone_vested(&schedule),
        };
        let already_released = schedule.released_amount;
        let to_beneficiary = vested.saturating_sub(already_released);
        let to_admin = schedule.total_amount.saturating_sub(vested);

        let client = token::Client::new(&env, &schedule.token);
        if to_beneficiary > 0 {
            client.transfer(&env.current_contract_address(), &schedule.beneficiary, &to_beneficiary);
        }
        if to_admin > 0 {
            client.transfer(&env.current_contract_address(), &admin, &to_admin);
        }

        schedule.released_amount = vested;
        schedule.revoked = true;
        save_schedule(&env, &schedule);

        Ok(to_admin)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_schedule(env: Env, schedule_id: u32) -> Result<VestingSchedule, Error> {
        load_schedule(&env, schedule_id)
    }

    /// Returns how many tokens are currently releasable.
    pub fn releasable_amount(env: Env, schedule_id: u32) -> Result<i128, Error> {
        let schedule = load_schedule(&env, schedule_id)?;
        if schedule.revoked {
            return Ok(0);
        }
        let now = env.ledger().timestamp();
        if now < schedule.cliff_timestamp {
            return Ok(0);
        }
        Ok(match schedule.vesting_type {
            VestingType::Linear => compute_linear_releasable(&schedule, now),
            VestingType::Milestone => compute_milestone_releasable(&schedule),
        })
    }

    pub fn schedule_count(env: Env) -> u32 {
        get_count(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

/// Total linearly vested amount at `now` (ignores already released).
fn compute_linear_vested(s: &VestingSchedule, now: u64) -> i128 {
    if now >= s.end_timestamp {
        return s.total_amount;
    }
    let elapsed = (now - s.cliff_timestamp) as i128;
    let duration = (s.end_timestamp - s.cliff_timestamp) as i128;
    s.total_amount * elapsed / duration
}

/// Releasable = vested - already released.
fn compute_linear_releasable(s: &VestingSchedule, now: u64) -> i128 {
    compute_linear_vested(s, now).saturating_sub(s.released_amount)
}

/// Total approved milestone allocation.
fn compute_milestone_vested(s: &VestingSchedule) -> i128 {
    let approved_bps: u32 = s
        .milestones
        .iter()
        .filter(|m| m.approved)
        .map(|m| m.pct_bps)
        .sum();
    s.total_amount * approved_bps as i128 / 10_000
}

fn compute_milestone_releasable(s: &VestingSchedule) -> i128 {
    compute_milestone_vested(s).saturating_sub(s.released_amount)
}
