// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # DAO Governance Contract
//!
//! Proposal lifecycle: Draft → Active → Passed/Defeated → Executed/Cancelled
//! - One governance token = one vote (with delegation).
//! - Quorum: configurable % of total supply (default 4%).
//! - Majority: votes_for > votes_against.
//! - 7-day voting period + 2-day execution timelock.
//! - Recursive delegation (up to depth 8).

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_balance, get_deposit, get_exec_delay, get_proposal, get_proposal_count, get_quorum_bps,
    get_total_supply, get_voting_period, has_voted, is_initialized, record_vote, remove_delegate,
    resolve_delegate, set_admin, set_balance, set_delegate, set_deposit, set_exec_delay,
    set_proposal, set_proposal_count, set_quorum_bps, set_total_supply, set_voting_period,
};
use crate::types::{Error, Proposal, ProposalStatus, VoteChoice};

#[contract]
pub struct Governance;

#[contractimpl]
impl Governance {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        quorum_bps: Option<i128>,
        voting_period: Option<u64>,
        exec_delay: Option<u64>,
        required_deposit: Option<i128>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        if let Some(q) = quorum_bps { set_quorum_bps(&env, q); }
        if let Some(v) = voting_period { set_voting_period(&env, v); }
        if let Some(e) = exec_delay { set_exec_delay(&env, e); }
        if let Some(d) = required_deposit { set_deposit(&env, d); }
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

    // ── Proposals ─────────────────────────────────────────────────────────────

    /// Create a new proposal. Returns the proposal ID.
    pub fn propose(
        env: Env,
        proposer: Address,
        title: String,
        description: String,
        deposit: i128,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        proposer.require_auth();
        if title.is_empty() {
            return Err(Error::EmptyTitle);
        }
        let required = get_deposit(&env);
        if deposit < required {
            return Err(Error::InsufficientDeposit);
        }
        // Proposer must have voting power.
        let power = voting_power(&env, &proposer);
        if power == 0 {
            return Err(Error::InsufficientVotingPower);
        }

        let now = env.ledger().timestamp();
        let vp = get_voting_period(&env);
        let ed = get_exec_delay(&env);
        let id = get_proposal_count(&env);

        let proposal = Proposal {
            id,
            proposer,
            title,
            description,
            status: ProposalStatus::Active,
            votes_for: 0,
            votes_against: 0,
            votes_abstain: 0,
            total_supply_snapshot: get_total_supply(&env),
            vote_start: now,
            vote_end: now + vp,
            execute_after: now + vp + ed,
            deposit,
        };
        set_proposal(&env, &proposal);
        set_proposal_count(&env, id + 1);

        env.events().publish((symbol_short!("proposed"),), id);
        Ok(id)
    }

    /// Cast a vote on an active proposal.
    pub fn vote(env: Env, voter: Address, proposal_id: u32, choice: VoteChoice) -> Result<(), Error> {
        ensure_initialized(&env)?;
        voter.require_auth();

        let mut proposal = get_proposal(&env, proposal_id)?;
        let now = env.ledger().timestamp();

        if proposal.status != ProposalStatus::Active {
            return Err(Error::VotingNotActive);
        }
        if now < proposal.vote_start || now > proposal.vote_end {
            return Err(Error::VotingNotActive);
        }
        // Use the effective delegate's power (resolves chain).
        let effective_voter = resolve_delegate(&env, &voter);
        if has_voted(&env, proposal_id, &effective_voter) {
            return Err(Error::AlreadyVoted);
        }

        let power = get_balance(&env, &effective_voter);
        if power == 0 {
            return Err(Error::InsufficientVotingPower);
        }

        record_vote(&env, proposal_id, &effective_voter);
        match choice {
            VoteChoice::For => proposal.votes_for += power,
            VoteChoice::Against => proposal.votes_against += power,
            VoteChoice::Abstain => proposal.votes_abstain += power,
        }
        set_proposal(&env, &proposal);

        env.events().publish((symbol_short!("voted"),), proposal_id);
        Ok(())
    }

    /// Finalise a proposal after voting ends. Anyone may call.
    pub fn finalise(env: Env, proposal_id: u32) -> Result<ProposalStatus, Error> {
        ensure_initialized(&env)?;
        let mut proposal = get_proposal(&env, proposal_id)?;
        let now = env.ledger().timestamp();

        if proposal.status != ProposalStatus::Active {
            return Err(Error::ProposalNotActive);
        }
        if now <= proposal.vote_end {
            return Err(Error::VotingNotActive);
        }

        let total_votes = proposal.votes_for + proposal.votes_against + proposal.votes_abstain;
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
        env.events().publish((symbol_short!("finalised"),), proposal_id);
        Ok(proposal.status)
    }

    /// Execute a passed proposal after the timelock.
    pub fn execute(env: Env, caller: Address, proposal_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();

        let mut proposal = get_proposal(&env, proposal_id)?;
        let now = env.ledger().timestamp();

        if proposal.status != ProposalStatus::Passed {
            return Err(Error::ProposalNotPassed);
        }
        if now < proposal.execute_after {
            return Err(Error::TimelockActive);
        }

        proposal.status = ProposalStatus::Executed;
        set_proposal(&env, &proposal);

        env.events().publish((symbol_short!("executed"),), proposal_id);
        Ok(())
    }

    /// Cancel an active proposal. Proposer or admin only.
    pub fn cancel(env: Env, caller: Address, proposal_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();

        let mut proposal = get_proposal(&env, proposal_id)?;
        let admin = storage::get_admin(&env)?;
        if caller != proposal.proposer && caller != admin {
            return Err(Error::Unauthorized);
        }
        if proposal.status != ProposalStatus::Active {
            return Err(Error::ProposalNotActive);
        }
        proposal.status = ProposalStatus::Cancelled;
        set_proposal(&env, &proposal);
        Ok(())
    }

    // ── Delegation ────────────────────────────────────────────────────────────

    /// Delegate voting power to `to`. Pass `None` to revoke.
    pub fn delegate(env: Env, from: Address, to: Option<Address>) -> Result<(), Error> {
        ensure_initialized(&env)?;
        from.require_auth();
        match to {
            Some(target) => {
                if target == from {
                    return Err(Error::SelfDelegation);
                }
                set_delegate(&env, &from, &target);
            }
            None => remove_delegate(&env, &from),
        }
        env.events().publish((symbol_short!("delegated"),), from);
        Ok(())
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

    pub fn get_voting_power(env: Env, addr: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(voting_power(&env, &addr))
    }

    pub fn get_balance(env: Env, addr: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_balance(&env, &addr))
    }

    pub fn get_delegate(env: Env, addr: Address) -> Result<Address, Error> {
        ensure_initialized(&env)?;
        Ok(resolve_delegate(&env, &addr))
    }

    pub fn get_total_supply(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_total_supply(&env))
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) { return Err(Error::NotInitialized); }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if storage::get_admin(env)? != *caller { return Err(Error::Unauthorized); }
    Ok(())
}

/// Effective voting power = own balance (delegation is resolved at vote time).
fn voting_power(env: &Env, addr: &Address) -> i128 {
    get_balance(env, addr)
}
