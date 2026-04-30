// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Quadratic Voting Contract
//!
//! Voters spend **credits** to cast votes. The number of votes received equals
//! `floor(sqrt(credits))`, making each additional vote progressively more
//! expensive and preventing whale dominance.
//!
//! ## Lifecycle
//! 1. Admin calls `initialize` to set up the contract.
//! 2. Admin whitelists voters via `whitelist`.
//! 3. Admin creates proposals via `create_proposal`.
//! 4. Whitelisted voters call `vote` with a credit amount.
//! 5. Anyone calls `finalize` after voting ends to record the outcome.
//! 6. Admin can `pause`/`unpause` the contract in emergencies.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_max_credits, get_proposal, get_proposal_count, get_user_credits,
    get_voting_period, has_voted, is_initialized, is_paused, is_whitelisted, record_vote,
    set_admin, set_max_credits, set_paused, set_proposal, set_proposal_count, set_user_credits,
    set_voting_period, set_whitelisted,
};
use crate::types::{Error, Proposal, ProposalStatus};

#[contract]
pub struct QuadraticVoting;

#[contractimpl]
impl QuadraticVoting {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        voting_period: Option<u64>,
        max_credits: Option<i128>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        if let Some(vp) = voting_period {
            set_voting_period(&env, vp);
        }
        if let Some(mc) = max_credits {
            set_max_credits(&env, mc);
        }
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Admin: pause / unpause ────────────────────────────────────────────────

    /// Pause all state-changing operations. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), admin);
        Ok(())
    }

    /// Resume operations. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), admin);
        Ok(())
    }

    // ── Admin: whitelist ──────────────────────────────────────────────────────

    /// Add or remove a voter from the whitelist. Admin only.
    pub fn whitelist(env: Env, admin: Address, voter: Address, allow: bool) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_whitelisted(&env, &voter, allow);
        env.events().publish((symbol_short!("wl"),), (voter, allow));
        Ok(())
    }

    // ── Proposals ─────────────────────────────────────────────────────────────

    /// Create a new proposal. Admin only. Returns the proposal ID.
    pub fn create_proposal(
        env: Env,
        admin: Address,
        title: String,
        description: String,
        duration: Option<u64>,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if title.is_empty() {
            return Err(Error::EmptyTitle);
        }

        let id = get_proposal_count(&env);
        let now = env.ledger().timestamp();
        let period = duration.unwrap_or_else(|| get_voting_period(&env));

        let proposal = Proposal {
            id,
            proposer: admin.clone(),
            title,
            description,
            status: ProposalStatus::Active,
            votes_for: 0,
            votes_against: 0,
            vote_start: now,
            vote_end: now + period,
        };
        set_proposal(&env, &proposal);
        set_proposal_count(&env, id + 1);

        env.events().publish((symbol_short!("proposed"),), id);
        Ok(id)
    }

    /// Cancel an active proposal. Admin only.
    pub fn cancel_proposal(env: Env, admin: Address, proposal_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut proposal = get_proposal(&env, proposal_id)?;
        if proposal.status != ProposalStatus::Active {
            return Err(Error::ProposalNotActive);
        }
        proposal.status = ProposalStatus::Cancelled;
        set_proposal(&env, &proposal);
        env.events().publish((symbol_short!("cancelled"),), proposal_id);
        Ok(())
    }

    // ── Voting ────────────────────────────────────────────────────────────────

    /// Cast a quadratic vote. `credits` is the number of voting credits to
    /// spend; votes received = floor(sqrt(credits)).
    /// `is_for`: true = vote for, false = vote against.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u32,
        credits: i128,
        is_for: bool,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        voter.require_auth();

        if !is_whitelisted(&env, &voter) {
            return Err(Error::NotWhitelisted);
        }
        if credits <= 0 {
            return Err(Error::InvalidCredits);
        }
        let max = get_max_credits(&env);
        if credits > max {
            return Err(Error::ExceedsMaxCredits);
        }

        let mut proposal = get_proposal(&env, proposal_id)?;
        if proposal.status != ProposalStatus::Active {
            return Err(Error::ProposalNotActive);
        }
        let now = env.ledger().timestamp();
        if now < proposal.vote_start || now > proposal.vote_end {
            return Err(Error::VotingNotActive);
        }
        if has_voted(&env, proposal_id, &voter) {
            return Err(Error::AlreadyVoted);
        }

        let votes = integer_sqrt(credits as u64) as i128;

        if is_for {
            proposal.votes_for += votes;
        } else {
            proposal.votes_against += votes;
        }

        record_vote(&env, proposal_id, &voter);
        set_user_credits(&env, &voter, proposal_id, credits);
        set_proposal(&env, &proposal);

        env.events().publish((symbol_short!("voted"),), (voter, proposal_id, credits, votes, is_for));
        Ok(votes)
    }

    /// Finalize a proposal after voting ends. Anyone may call.
    pub fn finalize(env: Env, proposal_id: u32) -> Result<ProposalStatus, Error> {
        ensure_initialized(&env)?;
        let mut proposal = get_proposal(&env, proposal_id)?;
        if proposal.status != ProposalStatus::Active {
            return Err(Error::ProposalNotActive);
        }
        let now = env.ledger().timestamp();
        if now <= proposal.vote_end {
            return Err(Error::VotingStillActive);
        }
        proposal.status = if proposal.votes_for > proposal.votes_against {
            ProposalStatus::Passed
        } else {
            ProposalStatus::Defeated
        };
        set_proposal(&env, &proposal);
        env.events().publish((symbol_short!("finalized"),), proposal_id);
        Ok(proposal.status)
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_proposal(env: Env, id: u32) -> Result<Proposal, Error> {
        ensure_initialized(&env)?;
        get_proposal(&env, id)
    }

    pub fn get_proposal_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_proposal_count(&env))
    }

    pub fn get_user_credits(env: Env, voter: Address, proposal_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_user_credits(&env, &voter, proposal_id))
    }

    pub fn is_whitelisted(env: Env, voter: Address) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(is_whitelisted(&env, &voter))
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Compute votes for a given credit amount (off-chain helper).
    pub fn credits_to_votes(_env: Env, credits: i128) -> i128 {
        if credits <= 0 { return 0; }
        integer_sqrt(credits as u64) as i128
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

/// Integer square root via Newton's method.
fn integer_sqrt(n: u64) -> u64 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}
