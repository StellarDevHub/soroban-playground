// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Decentralized Insurance Protocol
//!
//! A Soroban smart contract providing:
//! - Coverage marketplace: admin lists products with risk scores and premiums.
//! - Policy purchase: users buy coverage for a fixed term.
//! - Claim filing: policyholders file claims with a description.
//! - Claim voting: any address can vote approve/reject; result finalised after voting window.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_claim, get_claim_count, get_policy, get_policy_count, get_product,
    get_product_count, has_voted, is_initialized, record_vote, set_admin, set_claim,
    set_claim_count, set_policy, set_policy_count, set_product, set_product_count,
};
use crate::types::{Claim, ClaimStatus, CoverageProduct, Error, Policy};

/// Policy term: 1 year in seconds.
const POLICY_TERM_SECS: u64 = 31_536_000;
/// Voting window: 7 days in seconds.
const VOTING_WINDOW_SECS: u64 = 604_800;
/// Minimum votes required to finalise a claim.
const MIN_VOTES: u32 = 3;
/// Maximum risk score.
const MAX_RISK_SCORE: u32 = 100;

#[contract]
pub struct InsuranceProtocol;

#[contractimpl]
impl InsuranceProtocol {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    // ── Coverage marketplace (admin) ──────────────────────────────────────────

    /// List a new coverage product. Returns the product ID.
    pub fn list_product(
        env: Env,
        admin: Address,
        name: String,
        premium: i128,
        coverage_amount: i128,
        risk_score: u32,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if premium <= 0 {
            return Err(Error::ZeroPremium);
        }
        if coverage_amount <= 0 {
            return Err(Error::ZeroCoverage);
        }
        if risk_score == 0 || risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRiskScore);
        }

        let id = get_product_count(&env) + 1;
        let product = CoverageProduct {
            name,
            premium,
            coverage_amount,
            risk_score,
            is_active: true,
        };
        set_product(&env, id, &product);
        set_product_count(&env, id);

        env.events()
            .publish((symbol_short!("prod_add"), id), risk_score);

        Ok(id)
    }

    /// Deactivate a product so no new policies can be purchased.
    pub fn deactivate_product(env: Env, admin: Address, product_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut product = get_product(&env, product_id)?;
        product.is_active = false;
        set_product(&env, product_id, &product);
        Ok(())
    }

    // ── Policy purchase ───────────────────────────────────────────────────────

    /// Purchase a policy for a product. Returns the policy ID.
    pub fn buy_policy(env: Env, holder: Address, product_id: u32) -> Result<u32, Error> {
        Self::assert_initialized(&env)?;
        holder.require_auth();

        let product = get_product(&env, product_id)?;
        if !product.is_active {
            return Err(Error::PolicyInactive);
        }

        let now = env.ledger().timestamp();
        let id = get_policy_count(&env) + 1;
        let policy = Policy {
            holder: holder.clone(),
            product_id,
            start_ts: now,
            expiry_ts: now + POLICY_TERM_SECS,
            is_active: true,
        };
        set_policy(&env, id, &policy);
        set_policy_count(&env, id);

        env.events()
            .publish((symbol_short!("policy"), id), (holder, product_id));

        Ok(id)
    }

    // ── Claims ────────────────────────────────────────────────────────────────

    /// File a claim against an active policy. Returns the claim ID.
    pub fn file_claim(
        env: Env,
        claimant: Address,
        policy_id: u32,
        description: String,
    ) -> Result<u32, Error> {
        Self::assert_initialized(&env)?;
        claimant.require_auth();

        let policy = get_policy(&env, policy_id)?;
        if !policy.is_active {
            return Err(Error::PolicyInactive);
        }
        if policy.holder != claimant {
            return Err(Error::Unauthorized);
        }

        let now = env.ledger().timestamp();
        if now > policy.expiry_ts {
            return Err(Error::PolicyInactive);
        }

        let id = get_claim_count(&env) + 1;
        let claim = Claim {
            policy_id,
            claimant: claimant.clone(),
            description,
            status: ClaimStatus::Pending,
            votes_for: 0,
            votes_against: 0,
            voting_ends_ts: now + VOTING_WINDOW_SECS,
        };
        set_claim(&env, id, &claim);
        set_claim_count(&env, id);

        env.events()
            .publish((symbol_short!("claim"), id), (claimant, policy_id));

        Ok(id)
    }

    /// Vote on a pending claim. `approve = true` votes for payout.
    pub fn vote_claim(
        env: Env,
        voter: Address,
        claim_id: u32,
        approve: bool,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        voter.require_auth();

        let mut claim = get_claim(&env, claim_id)?;

        if claim.status != ClaimStatus::Pending {
            return Err(Error::ClaimNotVotable);
        }
        if has_voted(&env, claim_id, &voter) {
            return Err(Error::AlreadyVoted);
        }

        if approve {
            claim.votes_for += 1;
        } else {
            claim.votes_against += 1;
        }

        record_vote(&env, claim_id, &voter);
        set_claim(&env, claim_id, &claim);

        env.events()
            .publish((symbol_short!("vote"), claim_id), (voter, approve));

        Ok(())
    }

    /// Finalise a claim after the voting window has closed.
    /// Approved if votes_for > votes_against and total >= MIN_VOTES.
    pub fn finalise_claim(env: Env, claim_id: u32) -> Result<ClaimStatus, Error> {
        Self::assert_initialized(&env)?;

        let mut claim = get_claim(&env, claim_id)?;

        if claim.status != ClaimStatus::Pending {
            return Err(Error::ClaimAlreadyFinalised);
        }

        let now = env.ledger().timestamp();
        if now < claim.voting_ends_ts {
            return Err(Error::VotingPeriodActive);
        }

        let total = claim.votes_for + claim.votes_against;
        if total < MIN_VOTES {
            return Err(Error::InsufficientVotes);
        }

        claim.status = if claim.votes_for > claim.votes_against {
            ClaimStatus::Approved
        } else {
            ClaimStatus::Rejected
        };

        set_claim(&env, claim_id, &claim);

        env.events()
            .publish((symbol_short!("finalise"), claim_id), claim.status);

        Ok(claim.status)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_product(env: Env, product_id: u32) -> Result<CoverageProduct, Error> {
        get_product(&env, product_id)
    }

    pub fn get_policy(env: Env, policy_id: u32) -> Result<Policy, Error> {
        get_policy(&env, policy_id)
    }

    pub fn get_claim(env: Env, claim_id: u32) -> Result<Claim, Error> {
        get_claim(&env, claim_id)
    }

    pub fn product_count(env: Env) -> u32 {
        get_product_count(&env)
    }

    pub fn policy_count(env: Env) -> u32 {
        get_policy_count(&env)
    }

    pub fn claim_count(env: Env) -> u32 {
        get_claim_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
