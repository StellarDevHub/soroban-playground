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
    get_admin, get_balance, get_proposal, get_proposal_count, get_quorum_bps,
    get_total_supply, get_voting_period, has_voted, is_initialized, is_paused, is_whitelisted,
    record_vote, set_admin, set_balance, set_paused, set_proposal, set_proposal_count,
    set_quorum_bps, set_total_supply, set_voting_period, set_whitelisted,
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
        quorum_bps: Option<i128>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        if let Some(vp) = voting_period {
            set_voting_period(&env, vp);
        }
        if let Some(qb) = quorum_bps {
            set_quorum_bps(&env, qb);
        }
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Token management (admin mints for testing / bootstrapping) ────────────

    /// Mint governance tokens to `recipient`. Admin only.
    pub fn mint(env: Env, admin: Address, recipient: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let new_bal = get_balance(&env, &recipient) + amount;
        set_balance(&env, &recipient, new_bal);
        set_total_supply(&env, get_total_supply(&env) + amount);
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
            total_supply_snapshot: get_total_supply(&env),
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

    /// Cast a quadratic vote. Voting power = floor(sqrt(token_balance)).
    /// `is_for`: true = vote for, false = vote against.
    pub fn vote(
        env: Env,
        voter: Address,
        proposal_id: u32,
        is_for: bool,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        voter.require_auth();

        if !is_whitelisted(&env, &voter) {
            return Err(Error::NotWhitelisted);
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

        let balance = get_balance(&env, &voter);
        if balance == 0 {
            return Err(Error::InsufficientVotingPower);
        }

        let votes = integer_sqrt(balance as u64) as i128;

        if is_for {
            proposal.votes_for += votes;
        } else {
            proposal.votes_against += votes;
        }

        record_vote(&env, proposal_id, &voter);
        set_proposal(&env, &proposal);

        env.events().publish((symbol_short!("voted"),), (voter, proposal_id, votes, is_for));
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

        let total_votes = proposal.votes_for + proposal.votes_against;
        let quorum_needed = proposal.total_supply_snapshot
            .saturating_mul(get_quorum_bps(&env)) / 10_000;

        proposal.status = if total_votes >= quorum_needed
            && proposal.votes_for > proposal.votes_against
        {
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

    pub fn get_balance(env: Env, addr: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_balance(&env, &addr))
    }

    pub fn get_total_supply(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_total_supply(&env))
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

    /// Compute voting power for a given token balance (off-chain helper).
    pub fn balance_to_voting_power(_env: Env, balance: i128) -> i128 {
        if balance <= 0 { return 0; }
        integer_sqrt(balance as u64) as i128
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
