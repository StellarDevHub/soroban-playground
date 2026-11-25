// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Bug Bounty Contract
//!
//! Manages vulnerability disclosure reports with severity-based rewards,
//! lifecycle tracking, and an emergency pause mechanism.
//!
//! ## Researcher protections
//!
//! * **Escrow tier locks** – submitting a report escrows its severity's reward
//!   tier out of the available pool until the report is accepted, rejected or
//!   withdrawn. The tier is a snapshot, so a later `set_reward` cannot shrink it.
//! * **30-day cancellation notice** – the program can only be cancelled after
//!   `request_cancellation` has aged [`CANCELLATION_NOTICE_SECS`] *and* no open
//!   report still holds an escrow lock.
//! * **Triager arbitration** – if the admin proposes a different severity, the
//!   reporter may accept it or escalate to a third-party triager whose ruling is
//!   final.
//! * **Proof-of-prior-art** – a write-once commitment to the *encrypted*
//!   write-up can be recorded per report.

#![no_std]

mod storage;
mod test;
mod test_safeguards;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env, String};

use crate::storage::{
    clear_cancel_requested_at, clear_open_report_flag, get_active_report_count, get_admin,
    get_cancel_requested_at, get_locked_balance, get_pool_balance, get_prior_art, get_report,
    get_report_count, get_reward_for_severity, get_triager, has_open_report, is_cancelled,
    is_initialized, is_paused, set_active_report_count, set_admin, set_cancel_requested_at,
    set_cancelled, set_locked_balance, set_open_report_flag, set_paused, set_pool_balance,
    set_prior_art, set_report, set_report_count, set_reward_for_severity, set_triager,
};
use crate::types::{Error, PriorArt, Report, ReportStatus, Severity};

/// Notice period between `request_cancellation` and `execute_cancellation`.
pub const CANCELLATION_NOTICE_SECS: u64 = 30 * 24 * 60 * 60;

#[contract]
pub struct BugBountyContract;

#[contractimpl]
impl BugBountyContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin and an initial pool deposit.
    pub fn initialize(env: Env, admin: Address, initial_pool: i128) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if initial_pool < 0 {
            return Err(Error::NegativeInitialPool);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_pool_balance(&env, initial_pool);
        set_report_count(&env, 0);
        set_paused(&env, false);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    /// Pause or unpause the contract (admin only).
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, paused);
        let tag = if paused {
            symbol_short!("paused")
        } else {
            symbol_short!("unpaused")
        };
        env.events().publish((tag,), ());
        Ok(())
    }

    /// Top up the reward pool (admin only).
    pub fn fund_pool(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if is_cancelled(&env) {
            return Err(Error::ProgramCancelled);
        }
        if amount <= 0 {
            return Err(Error::NonPositiveFundAmount);
        }
        let balance = get_pool_balance(&env);
        let new_balance = balance.checked_add(amount).ok_or(Error::PoolOverflow)?;
        set_pool_balance(&env, new_balance);
        Ok(())
    }

    /// Override the default reward for a severity tier (admin only).
    pub fn set_reward(
        env: Env,
        admin: Address,
        severity: Severity,
        amount: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount == 0 {
            return Err(Error::ZeroReward);
        }
        // Cap at 10 000 XLM (100_000_000_000 stroops) per single payout tier
        if amount > 100_000_000_000 {
            return Err(Error::RewardTooLarge);
        }
        set_reward_for_severity(&env, severity, amount);
        Ok(())
    }

    // ── Reporter actions ──────────────────────────────────────────────────────

    /// Submit a new vulnerability report.
    pub fn submit_report(
        env: Env,
        reporter: Address,
        title: String,
        description_hash: String,
        severity: Severity,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized_guard(&env)?;
        if is_cancelled(&env) {
            return Err(Error::ProgramCancelled);
        }
        reporter.require_auth();

        if title.is_empty() {
            return Err(Error::EmptyTitle);
        }
        if title.len() > 128 {
            return Err(Error::TitleTooLong);
        }
        if description_hash.is_empty() {
            return Err(Error::EmptyDescriptionHash);
        }
        if description_hash.len() > 256 {
            return Err(Error::DescriptionHashTooLong);
        }
        if has_open_report(&env, &reporter) {
            return Err(Error::AlreadyHasOpenReport);
        }

        // Escrow this severity's reward tier. Submission only succeeds when the
        // unlocked pool can cover it, so an accepted report is always payable.
        let reward_tier = get_reward_for_severity(&env, severity);
        let locked = get_locked_balance(&env);
        let available = get_pool_balance(&env) - locked;
        if available < reward_tier {
            return Err(Error::InsufficientPool);
        }

        let id = get_report_count(&env) + 1;
        let now = env.ledger().timestamp();

        let report = Report {
            id,
            reporter: reporter.clone(),
            title,
            description_hash,
            severity,
            status: ReportStatus::Pending,
            reward_amount: 0,
            submitted_at: now,
            updated_at: now,
            locked_reward: reward_tier,
            has_proposal: false,
            proposed_severity: severity,
            disputed: false,
        };

        set_report(&env, &report);
        set_report_count(&env, id);
        set_open_report_flag(&env, &reporter);
        set_locked_balance(&env, locked + reward_tier);
        set_active_report_count(&env, get_active_report_count(&env) + 1);

        env.events()
            .publish((symbol_short!("submitted"), reporter), id);
        Ok(id)
    }

    /// Withdraw a pending report (reporter only).
    pub fn withdraw_report(env: Env, reporter: Address, report_id: u32) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;
        reporter.require_auth();

        let mut report = get_report(&env, report_id)?;
        if report.reporter != reporter {
            return Err(Error::Unauthorized);
        }
        if report.status != ReportStatus::Pending && report.status != ReportStatus::UnderReview {
            return Err(Error::ReportAlreadyClosed);
        }

        report.status = ReportStatus::Withdrawn;
        report.updated_at = env.ledger().timestamp();
        Self::release_lock(&env, &mut report);
        set_report(&env, &report);
        clear_open_report_flag(&env, &reporter);

        env.events()
            .publish((symbol_short!("withdrawn"), reporter), report_id);
        Ok(())
    }

    // ── Admin review ──────────────────────────────────────────────────────────

    /// Move a report to UnderReview (admin only).
    pub fn start_review(env: Env, admin: Address, report_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;

        let mut report = get_report(&env, report_id)?;
        if report.status != ReportStatus::Pending {
            return Err(Error::InvalidStatus);
        }

        report.status = ReportStatus::UnderReview;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("review"), report_id), ());
        Ok(())
    }

    /// Accept a report and assign a reward (admin only).
    pub fn accept_report(env: Env, admin: Address, report_id: u32) -> Result<i128, Error> {
        Self::assert_admin(&env, &admin)?;

        let mut report = get_report(&env, report_id)?;
        if report.status != ReportStatus::UnderReview {
            return Err(Error::InvalidStatus);
        }

        if report.disputed {
            return Err(Error::DisputeOpen);
        }
        if report.has_proposal {
            return Err(Error::SeverityProposalPending);
        }

        // Pay exactly what was escrowed for this report.
        let reward = report.locked_reward;
        let pool = get_pool_balance(&env);
        if pool < reward {
            return Err(Error::InsufficientPool);
        }

        report.status = ReportStatus::Accepted;
        report.reward_amount = reward;
        report.updated_at = env.ledger().timestamp();
        Self::release_lock(&env, &mut report);
        set_report(&env, &report);
        set_pool_balance(&env, pool - reward);

        env.events()
            .publish((symbol_short!("accepted"), report_id), reward);
        Ok(reward)
    }

    /// Reject a report (admin only).
    pub fn reject_report(env: Env, admin: Address, report_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;

        let mut report = get_report(&env, report_id)?;
        if report.status != ReportStatus::Pending && report.status != ReportStatus::UnderReview {
            return Err(Error::InvalidStatus);
        }
        // A disputed severity must be ruled on by the triager before the admin
        // can close the report.
        if report.disputed {
            return Err(Error::DisputeOpen);
        }

        report.status = ReportStatus::Rejected;
        report.updated_at = env.ledger().timestamp();
        Self::release_lock(&env, &mut report);
        set_report(&env, &report);
        clear_open_report_flag(&env, &report.reporter);

        env.events()
            .publish((symbol_short!("rejected"), report_id), ());
        Ok(())
    }

    /// Mark reward as paid out (admin only).
    pub fn mark_paid(env: Env, admin: Address, report_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;

        let mut report = get_report(&env, report_id)?;
        if report.status != ReportStatus::Accepted {
            return Err(Error::NothingToClaim);
        }

        report.status = ReportStatus::Paid;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);
        clear_open_report_flag(&env, &report.reporter);

        env.events()
            .publish((symbol_short!("paid"), report_id), report.reward_amount);
        Ok(())
    }

    // ── Severity arbitration ──────────────────────────────────────────────────

    /// Set the third-party triager who arbitrates disputed severities (admin only).
    pub fn set_triager(env: Env, admin: Address, triager: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_triager(&env, &triager);
        env.events().publish((symbol_short!("triager"),), triager);
        Ok(())
    }

    /// Propose a different severity for an open report (admin only). The report
    /// cannot be accepted until the reporter accepts the proposal or the triager
    /// rules on a dispute.
    pub fn propose_severity(
        env: Env,
        admin: Address,
        report_id: u32,
        severity: Severity,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;

        let mut report = get_report(&env, report_id)?;
        Self::assert_open(&report)?;
        if report.disputed {
            return Err(Error::DisputeOpen);
        }
        if severity == report.severity {
            return Err(Error::SameSeverity);
        }

        report.has_proposal = true;
        report.proposed_severity = severity;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("proposed"), report_id), severity);
        Ok(())
    }

    /// Reporter agrees to the admin's proposed severity; the escrow tier is
    /// re-locked to match.
    pub fn accept_proposal(env: Env, reporter: Address, report_id: u32) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;
        reporter.require_auth();

        let mut report = get_report(&env, report_id)?;
        if report.reporter != reporter {
            return Err(Error::Unauthorized);
        }
        Self::assert_open(&report)?;
        if report.disputed {
            return Err(Error::DisputeOpen);
        }
        if !report.has_proposal {
            return Err(Error::NoSeverityProposal);
        }
        let severity = report.proposed_severity;

        Self::relock_tier(&env, &mut report, severity)?;
        report.has_proposal = false;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("sev_set"), report_id), severity);
        Ok(())
    }

    /// Reporter escalates the admin's proposed severity to the triager.
    pub fn dispute_severity(env: Env, reporter: Address, report_id: u32) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;
        reporter.require_auth();

        let mut report = get_report(&env, report_id)?;
        if report.reporter != reporter {
            return Err(Error::Unauthorized);
        }
        Self::assert_open(&report)?;
        if report.disputed {
            return Err(Error::DisputeOpen);
        }
        if !report.has_proposal {
            return Err(Error::NoSeverityProposal);
        }
        if get_triager(&env).is_none() {
            return Err(Error::TriagerNotSet);
        }

        report.disputed = true;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("disputed"), report_id), ());
        Ok(())
    }

    /// Final ruling on a disputed severity (triager only). The escrow tier is
    /// re-locked to the ruled severity; raising it needs unlocked pool funds.
    pub fn resolve_dispute(
        env: Env,
        triager: Address,
        report_id: u32,
        final_severity: Severity,
    ) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;
        triager.require_auth();
        let configured = get_triager(&env).ok_or(Error::TriagerNotSet)?;
        if triager != configured {
            return Err(Error::NotTriager);
        }

        let mut report = get_report(&env, report_id)?;
        Self::assert_open(&report)?;
        if !report.disputed {
            return Err(Error::NotDisputed);
        }

        Self::relock_tier(&env, &mut report, final_severity)?;
        report.has_proposal = false;
        report.disputed = false;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("resolved"), report_id), final_severity);
        Ok(())
    }

    // ── Proof of prior art ────────────────────────────────────────────────────

    /// Record a write-once commitment (e.g. SHA-256) to the **encrypted**
    /// vulnerability write-up as proof-of-prior-art (reporter only). The
    /// plaintext and key never touch the chain, and the commitment can never be
    /// replaced.
    pub fn attach_prior_art(
        env: Env,
        reporter: Address,
        report_id: u32,
        commitment: BytesN<32>,
    ) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;
        reporter.require_auth();

        let report = get_report(&env, report_id)?;
        if report.reporter != reporter {
            return Err(Error::Unauthorized);
        }
        if get_prior_art(&env, report_id).is_some() {
            return Err(Error::PriorArtAlreadySet);
        }

        let art = PriorArt {
            commitment: commitment.clone(),
            committed_at: env.ledger().timestamp(),
        };
        set_prior_art(&env, report_id, &art);

        env.events()
            .publish((symbol_short!("prior_art"), report_id), commitment);
        Ok(())
    }

    // ── Program cancellation (30-day notice) ──────────────────────────────────

    /// Start the 30-day cancellation notice (admin only). Researchers can keep
    /// submitting during the notice period.
    pub fn request_cancellation(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if is_cancelled(&env) {
            return Err(Error::ProgramCancelled);
        }
        if get_cancel_requested_at(&env).is_some() {
            return Err(Error::CancellationAlreadyRequested);
        }
        let now = env.ledger().timestamp();
        set_cancel_requested_at(&env, now);
        env.events().publish((symbol_short!("cancel_rq"),), now);
        Ok(())
    }

    /// Withdraw a pending cancellation request (admin only).
    pub fn abort_cancellation(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if get_cancel_requested_at(&env).is_none() {
            return Err(Error::CancellationNotRequested);
        }
        clear_cancel_requested_at(&env);
        env.events().publish((symbol_short!("cancel_ab"),), ());
        Ok(())
    }

    /// Cancel the program and release the unlocked pool (admin only).
    ///
    /// Requires that the notice period has elapsed **and** that no open report
    /// still holds an escrow lock. Returns the amount released from the pool.
    pub fn execute_cancellation(env: Env, admin: Address) -> Result<i128, Error> {
        Self::assert_admin(&env, &admin)?;
        if is_cancelled(&env) {
            return Err(Error::ProgramCancelled);
        }
        let requested_at = get_cancel_requested_at(&env).ok_or(Error::CancellationNotRequested)?;
        let unlock_at = requested_at.saturating_add(CANCELLATION_NOTICE_SECS);
        if env.ledger().timestamp() < unlock_at {
            return Err(Error::NoticePeriodActive);
        }
        if get_active_report_count(&env) > 0 {
            return Err(Error::ActiveSubmissionsLocked);
        }

        let locked = get_locked_balance(&env);
        let released = get_pool_balance(&env) - locked;
        set_pool_balance(&env, locked);
        set_cancelled(&env);
        clear_cancel_requested_at(&env);

        env.events()
            .publish((symbol_short!("cancelled"),), released);
        Ok(released)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_report(env: Env, report_id: u32) -> Result<Report, Error> {
        get_report(&env, report_id)
    }

    pub fn report_count(env: Env) -> u32 {
        get_report_count(&env)
    }

    pub fn pool_balance(env: Env) -> i128 {
        get_pool_balance(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn reward_for_severity(env: Env, severity: Severity) -> i128 {
        get_reward_for_severity(&env, severity)
    }

    /// Pool funds escrowed for open reports.
    pub fn locked_balance(env: Env) -> i128 {
        get_locked_balance(&env)
    }

    /// Pool funds not escrowed for any open report.
    pub fn available_balance(env: Env) -> i128 {
        get_pool_balance(&env) - get_locked_balance(&env)
    }

    /// Number of reports that are Pending or UnderReview.
    pub fn active_report_count(env: Env) -> u32 {
        get_active_report_count(&env)
    }

    pub fn get_triager(env: Env) -> Option<Address> {
        get_triager(&env)
    }

    pub fn is_cancelled(env: Env) -> bool {
        is_cancelled(&env)
    }

    /// Timestamp of the pending cancellation request, if any.
    pub fn cancellation_requested_at(env: Env) -> Option<u64> {
        get_cancel_requested_at(&env)
    }

    /// Proof-of-prior-art commitment for a report, if one was recorded.
    pub fn get_prior_art(env: Env, report_id: u32) -> Option<PriorArt> {
        get_prior_art(&env, report_id)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn assert_open(report: &Report) -> Result<(), Error> {
        if report.status != ReportStatus::Pending && report.status != ReportStatus::UnderReview {
            return Err(Error::ReportAlreadyClosed);
        }
        Ok(())
    }

    /// Release the escrow held by a report that is leaving the open states.
    fn release_lock(env: &Env, report: &mut Report) {
        set_locked_balance(env, get_locked_balance(env) - report.locked_reward);
        set_active_report_count(env, get_active_report_count(env).saturating_sub(1));
        report.locked_reward = 0;
        report.has_proposal = false;
        report.disputed = false;
    }

    /// Move a report's escrow to `severity`'s tier. Raising the tier needs enough
    /// unlocked pool funds.
    fn relock_tier(env: &Env, report: &mut Report, severity: Severity) -> Result<(), Error> {
        let new_reward = get_reward_for_severity(env, severity);
        let delta = new_reward - report.locked_reward;
        let locked = get_locked_balance(env);
        if delta > 0 && get_pool_balance(env) - locked < delta {
            return Err(Error::InsufficientPool);
        }
        set_locked_balance(env, locked + delta);
        report.locked_reward = new_reward;
        report.severity = severity;
        Ok(())
    }

    fn assert_initialized_guard(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized_guard(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
