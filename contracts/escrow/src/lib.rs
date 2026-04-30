#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};

use crate::storage::{
    get_analytics, get_arbiter_fee_bps, get_escrow, get_escrow_count, get_milestone,
    increment_escrow_count, is_initialized, set_admin, set_analytics, set_arbiter_fee_bps,
    set_escrow, set_initialized, set_milestone,
};
use crate::types::{Analytics, Error, Escrow, EscrowStatus, Milestone, MilestoneStatus, Ruling};

#[contract]
pub struct FreelancerEscrow;

#[contractimpl]
impl FreelancerEscrow {
    /// Initialize the contract. `arbiter_fee_bps` is basis points (e.g. 200 = 2%).
    pub fn initialize(env: Env, admin: Address, arbiter_fee_bps: u32) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_arbiter_fee_bps(&env, arbiter_fee_bps);
        set_initialized(&env);
        set_analytics(&env, &Analytics {
            total_escrows: 0,
            active_escrows: 0,
            completed_escrows: 0,
            disputed_escrows: 0,
            cancelled_escrows: 0,
            total_value_locked: 0,
            total_paid_out: 0,
        });
        Ok(())
    }

    /// Client creates a new escrow agreement.
    /// `milestone_amounts` must be non-empty and sum to `total_amount`.
    pub fn create_escrow(
        env: Env,
        client: Address,
        freelancer: Address,
        arbiter: Address,
        total_amount: i128,
        milestone_amounts: Vec<i128>,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        client.require_auth();

        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if milestone_amounts.is_empty() {
            return Err(Error::NoMilestones);
        }
        if milestone_amounts.len() > 20 {
            return Err(Error::TooManyMilestones);
        }

        // Validate milestones sum to total_amount.
        let mut sum: i128 = 0;
        for amt in milestone_amounts.iter() {
            if amt <= 0 {
                return Err(Error::InvalidAmount);
            }
            sum += amt;
        }
        if sum != total_amount {
            return Err(Error::InvalidAmount);
        }

        let id = increment_escrow_count(&env);
        let arbiter_fee_bps = get_arbiter_fee_bps(&env);

        let escrow = Escrow {
            id,
            client: client.clone(),
            freelancer: freelancer.clone(),
            arbiter,
            total_amount,
            paid_amount: 0,
            milestone_count: milestone_amounts.len(),
            status: EscrowStatus::Pending,
            created_at: env.ledger().timestamp(),
            arbiter_fee_bps,
        };
        set_escrow(&env, &escrow);

        // Persist each milestone.
        let mut milestone_id: u32 = 1;
        for amt in milestone_amounts.iter() {
            set_milestone(&env, id, &Milestone {
                id: milestone_id,
                amount: amt,
                status: MilestoneStatus::Pending,
            });
            milestone_id += 1;
        }

        let mut analytics = get_analytics(&env);
        analytics.total_escrows += 1;
        set_analytics(&env, &analytics);

        Ok(id)
    }

    /// Client deposits the full `total_amount`, activating the escrow.
    pub fn deposit(env: Env, escrow_id: u32, client: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        client.require_auth();

        let mut escrow = get_escrow(&env, escrow_id)?;
        if escrow.client != client {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Pending {
            return Err(Error::InvalidState);
        }

        escrow.status = EscrowStatus::Active;
        // Mark first milestone as InProgress automatically.
        let mut first = get_milestone(&env, escrow_id, 1)?;
        first.status = MilestoneStatus::InProgress;
        set_milestone(&env, escrow_id, &first);
        set_escrow(&env, &escrow);

        let mut analytics = get_analytics(&env);
        analytics.active_escrows += 1;
        analytics.total_value_locked += escrow.total_amount;
        set_analytics(&env, &analytics);

        Ok(())
    }

    /// Freelancer submits a milestone for client review.
    pub fn submit_milestone(
        env: Env,
        escrow_id: u32,
        freelancer: Address,
        milestone_id: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        freelancer.require_auth();

        let escrow = get_escrow(&env, escrow_id)?;
        if escrow.freelancer != freelancer {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Active {
            return Err(Error::InvalidState);
        }

        let mut milestone = get_milestone(&env, escrow_id, milestone_id)?;
        if milestone.status != MilestoneStatus::InProgress {
            return Err(Error::InvalidState);
        }

        milestone.status = MilestoneStatus::UnderReview;
        set_milestone(&env, escrow_id, &milestone);

        Ok(())
    }

    /// Client approves a submitted milestone.
    pub fn approve_milestone(
        env: Env,
        escrow_id: u32,
        client: Address,
        milestone_id: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        client.require_auth();

        let escrow = get_escrow(&env, escrow_id)?;
        if escrow.client != client {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Active {
            return Err(Error::InvalidState);
        }

        let mut milestone = get_milestone(&env, escrow_id, milestone_id)?;
        if milestone.status != MilestoneStatus::UnderReview {
            return Err(Error::InvalidState);
        }

        milestone.status = MilestoneStatus::Approved;
        set_milestone(&env, escrow_id, &milestone);

        Ok(())
    }

    /// Client rejects a submitted milestone, sending it back to InProgress.
    pub fn reject_milestone(
        env: Env,
        escrow_id: u32,
        client: Address,
        milestone_id: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        client.require_auth();

        let escrow = get_escrow(&env, escrow_id)?;
        if escrow.client != client {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Active {
            return Err(Error::InvalidState);
        }

        let mut milestone = get_milestone(&env, escrow_id, milestone_id)?;
        if milestone.status != MilestoneStatus::UnderReview {
            return Err(Error::InvalidState);
        }

        milestone.status = MilestoneStatus::InProgress;
        set_milestone(&env, escrow_id, &milestone);

        Ok(())
    }

    /// Client releases payment for an approved milestone.
    /// Returns the net amount paid to the freelancer (after arbiter fee).
    pub fn release_payment(
        env: Env,
        escrow_id: u32,
        client: Address,
        milestone_id: u32,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        client.require_auth();

        let mut escrow = get_escrow(&env, escrow_id)?;
        if escrow.client != client {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Active {
            return Err(Error::InvalidState);
        }

        let mut milestone = get_milestone(&env, escrow_id, milestone_id)?;
        if milestone.status != MilestoneStatus::Approved {
            return Err(Error::InvalidState);
        }

        let fee = (milestone.amount * escrow.arbiter_fee_bps as i128) / 10_000;
        let net = milestone.amount - fee;

        milestone.status = MilestoneStatus::Paid;
        set_milestone(&env, escrow_id, &milestone);

        escrow.paid_amount += milestone.amount;

        // Start the next pending milestone automatically.
        let next_id = milestone_id + 1;
        if next_id <= escrow.milestone_count {
            if let Ok(mut next) = get_milestone(&env, escrow_id, next_id) {
                if next.status == MilestoneStatus::Pending {
                    next.status = MilestoneStatus::InProgress;
                    set_milestone(&env, escrow_id, &next);
                }
            }
        }

        // If all milestones paid, complete the escrow.
        if escrow.paid_amount >= escrow.total_amount {
            escrow.status = EscrowStatus::Completed;
            let mut analytics = get_analytics(&env);
            analytics.active_escrows = analytics.active_escrows.saturating_sub(1);
            analytics.completed_escrows += 1;
            analytics.total_value_locked = analytics.total_value_locked.saturating_sub(escrow.total_amount);
            analytics.total_paid_out += escrow.total_amount;
            set_analytics(&env, &analytics);
        }

        set_escrow(&env, &escrow);

        Ok(net)
    }

    /// Either party raises a dispute, locking the escrow for arbiter review.
    pub fn raise_dispute(
        env: Env,
        escrow_id: u32,
        initiator: Address,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        initiator.require_auth();

        let mut escrow = get_escrow(&env, escrow_id)?;
        if escrow.client != initiator && escrow.freelancer != initiator {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Active {
            return Err(Error::InvalidState);
        }

        escrow.status = EscrowStatus::Disputed;
        set_escrow(&env, &escrow);

        let mut analytics = get_analytics(&env);
        analytics.disputed_escrows += 1;
        analytics.active_escrows = analytics.active_escrows.saturating_sub(1);
        set_analytics(&env, &analytics);

        Ok(())
    }

    /// Arbiter resolves a dispute.
    /// Ruling: 0 = FreelancerFavored, 1 = ClientFavored, 2 = Split.
    pub fn resolve_dispute(
        env: Env,
        escrow_id: u32,
        arbiter: Address,
        ruling: u32,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        arbiter.require_auth();

        let mut escrow = get_escrow(&env, escrow_id)?;
        if escrow.arbiter != arbiter {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Disputed {
            return Err(Error::InvalidState);
        }

        let ruling_enum = match ruling {
            0 => Ruling::FreelancerFavored,
            1 => Ruling::ClientFavored,
            2 => Ruling::Split,
            _ => return Err(Error::InvalidRuling),
        };

        let remaining = escrow.total_amount - escrow.paid_amount;
        let fee = (remaining * escrow.arbiter_fee_bps as i128) / 10_000;

        let payout = match ruling_enum {
            Ruling::FreelancerFavored => remaining - fee,
            Ruling::ClientFavored => 0,
            Ruling::Split => (remaining - fee) / 2,
        };

        escrow.paid_amount = escrow.total_amount; // mark fully settled
        escrow.status = EscrowStatus::Completed;
        set_escrow(&env, &escrow);

        let mut analytics = get_analytics(&env);
        analytics.completed_escrows += 1;
        analytics.total_value_locked = analytics.total_value_locked.saturating_sub(remaining);
        analytics.total_paid_out += remaining;
        set_analytics(&env, &analytics);

        Ok(payout)
    }

    /// Client cancels an escrow that has not yet been activated (Pending).
    pub fn cancel_escrow(env: Env, escrow_id: u32, client: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        client.require_auth();

        let mut escrow = get_escrow(&env, escrow_id)?;
        if escrow.client != client {
            return Err(Error::Unauthorized);
        }
        if escrow.status != EscrowStatus::Pending {
            return Err(Error::InvalidState);
        }

        escrow.status = EscrowStatus::Cancelled;
        set_escrow(&env, &escrow);

        let mut analytics = get_analytics(&env);
        analytics.cancelled_escrows += 1;
        set_analytics(&env, &analytics);

        Ok(())
    }

    // ── Read-only queries ──────────────────────────────────────────────────────

    pub fn get_escrow(env: Env, escrow_id: u32) -> Result<Escrow, Error> {
        get_escrow(&env, escrow_id)
    }

    pub fn get_milestone(env: Env, escrow_id: u32, milestone_id: u32) -> Result<Milestone, Error> {
        get_milestone(&env, escrow_id, milestone_id)
    }

    pub fn get_analytics(env: Env) -> Result<Analytics, Error> {
        ensure_initialized(&env)?;
        Ok(get_analytics(&env))
    }

    pub fn get_escrow_count(env: Env) -> u32 {
        get_escrow_count(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        Err(Error::NotInitialized)
    } else {
        Ok(())
    }
}
