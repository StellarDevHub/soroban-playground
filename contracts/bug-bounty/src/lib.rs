// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Decentralized Bug Bounty Contract
//!
//! A Soroban smart contract that manages a decentralized vulnerability
//! disclosure and reward distribution program.
//!
//! ## Lifecycle
//! 1. Admin initialises the contract and funds the bounty pool.
//! 2. Security researchers submit vulnerability reports (title + description
//!    hash + severity).
//! 3. Admin triages each report: moves it to `UnderReview`, then either
//!    `Accepted` (with a reward amount) or `Rejected`.
//! 4. Once accepted, the reporter calls `claim_reward` to receive their payout.
//! 5. Admin can pause/unpause the contract for emergency situations.
//!
//! ## Security patterns
//! - Checks-effects-interactions: state is updated before any token transfer.
//! - Pull-over-push: reporters pull their own rewards; no automatic push.
//! - Access control: admin-only functions guarded by `require_auth`.
//! - Spam prevention: one open report per reporter at a time.
//! - Emergency pause: admin can halt new submissions and reviews.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, String};

use crate::storage::{
    clear_open_report_flag, get_admin, get_pool_balance, get_report, get_report_count,
    get_reward_for_severity, has_open_report, is_initialized, is_paused, set_admin,
    set_open_report_flag, set_paused, set_pool_balance, set_report, set_report_count,
    set_reward_for_severity,
};
use crate::types::{Error, Report, ReportStatus, Severity};

#[contract]
pub struct BugBountyContract;

#[contractimpl]
impl BugBountyContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the bug bounty program.
    ///
    /// # Arguments
    /// * `admin`         – Address that will manage the program.
    /// * `reward_low`    – Optional override for Low-severity reward (stroops).
    /// * `reward_medium` – Optional override for Medium-severity reward.
    /// * `reward_high`   – Optional override for High-severity reward.
    /// * `reward_critical` – Optional override for Critical-severity reward.
    pub fn initialize(
        env: Env,
        admin: Address,
        reward_low: Option<i128>,
        reward_medium: Option<i128>,
        reward_high: Option<i128>,
        reward_critical: Option<i128>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_paused(&env, false);
        set_pool_balance(&env, 0);
        set_report_count(&env, 0);

        if let Some(v) = reward_low {
            set_reward_for_severity(&env, Severity::Low, v);
        }
        if let Some(v) = reward_medium {
            set_reward_for_severity(&env, Severity::Medium, v);
        }
        if let Some(v) = reward_high {
            set_reward_for_severity(&env, Severity::High, v);
        }
        if let Some(v) = reward_critical {
            set_reward_for_severity(&env, Severity::Critical, v);
        }

        env.events()
            .publish((symbol_short!("init"),), admin);

        Ok(())
    }

    // ── Pool funding ──────────────────────────────────────────────────────────

    /// Deposit XLM into the bounty pool.
    ///
    /// Anyone (typically the program sponsor) can top up the pool.
    /// Uses the native XLM token contract.
    ///
    /// # Arguments
    /// * `funder`        – Address funding the pool (must authorise).
    /// * `token`         – XLM token contract address.
    /// * `amount`        – Amount in stroops to deposit.
    pub fn fund_pool(
        env: Env,
        funder: Address,
        token_address: Address,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        funder.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroReward);
        }

        // Transfer tokens from funder to this contract.
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&funder, &env.current_contract_address(), &amount);

        let new_balance = get_pool_balance(&env) + amount;
        set_pool_balance(&env, new_balance);

        env.events()
            .publish((symbol_short!("funded"),), (funder, amount));

        Ok(())
    }

    // ── Report submission ─────────────────────────────────────────────────────

    /// Submit a vulnerability disclosure report.
    ///
    /// Each reporter may only have one open (Pending or UnderReview) report at
    /// a time to prevent spam.
    ///
    /// # Arguments
    /// * `reporter`          – Address of the security researcher.
    /// * `title`             – Short title of the vulnerability (non-empty).
    /// * `description_hash`  – Hash / IPFS CID of the full disclosure document.
    /// * `severity`          – Researcher's self-assessed severity.
    ///
    /// # Returns
    /// The new report ID.
    pub fn submit_report(
        env: Env,
        reporter: Address,
        title: String,
        description_hash: String,
        severity: Severity,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        reporter.require_auth();

        if title.is_empty() {
            return Err(Error::EmptyTitle);
        }
        if description_hash.is_empty() {
            return Err(Error::EmptyDescriptionHash);
        }
        if has_open_report(&env, &reporter) {
            return Err(Error::AlreadyHasOpenReport);
        }

        let now = env.ledger().timestamp();
        let id = get_report_count(&env) + 1;

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
        };

        // Effects before interactions.
        set_report(&env, &report);
        set_report_count(&env, id);
        set_open_report_flag(&env, &reporter);

        env.events()
            .publish((symbol_short!("reported"),), (reporter, id, severity as u32));

        Ok(id)
    }

    // ── Admin triage ──────────────────────────────────────────────────────────

    /// Move a Pending report to UnderReview. Admin only.
    pub fn start_review(env: Env, admin: Address, report_id: u32) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        ensure_not_paused(&env)?;

        let mut report = get_report(&env, report_id)?;
        if report.status != ReportStatus::Pending {
            return Err(Error::InvalidStatus);
        }

        report.status = ReportStatus::UnderReview;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("review"),), report_id);

        Ok(())
    }

    /// Accept a report and set the reward amount. Admin only.
    ///
    /// The reward defaults to the tier configured for the report's severity but
    /// can be overridden by the admin.
    ///
    /// # Arguments
    /// * `admin`       – Admin address (must authorise).
    /// * `report_id`   – ID of the report to accept.
    /// * `reward`      – Optional custom reward override (stroops). If `None`,
    ///                   the configured tier reward is used.
    pub fn accept_report(
        env: Env,
        admin: Address,
        report_id: u32,
        reward: Option<i128>,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        ensure_not_paused(&env)?;

        let mut report = get_report(&env, report_id)?;
        if report.status != ReportStatus::Pending && report.status != ReportStatus::UnderReview {
            return Err(Error::InvalidStatus);
        }

        let reward_amount = reward
            .unwrap_or_else(|| get_reward_for_severity(&env, report.severity));

        if reward_amount <= 0 {
            return Err(Error::ZeroReward);
        }
        if get_pool_balance(&env) < reward_amount {
            return Err(Error::InsufficientPool);
        }

        // Reserve the reward by reducing the pool balance immediately.
        // (Checks-effects-interactions: state change before any transfer.)
        set_pool_balance(&env, get_pool_balance(&env) - reward_amount);

        report.status = ReportStatus::Accepted;
        report.reward_amount = reward_amount;
        report.updated_at = env.ledger().timestamp();
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("accepted"),), (report_id, reward_amount));

        Ok(())
    }

    /// Reject a report. Admin only.
    pub fn reject_report(env: Env, admin: Address, report_id: u32) -> Result<(), Error> {
        assert_admin(&env, &admin)?;

        let mut report = get_report(&env, report_id)?;
        if report.status != ReportStatus::Pending && report.status != ReportStatus::UnderReview {
            return Err(Error::InvalidStatus);
        }

        report.status = ReportStatus::Rejected;
        report.updated_at = env.ledger().timestamp();

        // Release the open-report lock so the researcher can submit again.
        clear_open_report_flag(&env, &report.reporter);
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("rejected"),), report_id);

        Ok(())
    }

    // ── Reward claim (pull pattern) ───────────────────────────────────────────

    /// Claim the reward for an accepted report.
    ///
    /// Only the original reporter may call this. Uses the pull-over-push
    /// pattern: the reporter initiates the transfer.
    ///
    /// # Arguments
    /// * `reporter`      – Must match the report's reporter field.
    /// * `report_id`     – ID of the accepted report.
    /// * `token_address` – XLM token contract address.
    pub fn claim_reward(
        env: Env,
        reporter: Address,
        report_id: u32,
        token_address: Address,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        reporter.require_auth();

        let mut report = get_report(&env, report_id)?;

        if report.reporter != reporter {
            return Err(Error::Unauthorized);
        }
        if report.status != ReportStatus::Accepted {
            return Err(Error::NothingToClaim);
        }
        if report.reward_amount <= 0 {
            return Err(Error::ZeroReward);
        }

        let payout = report.reward_amount;

        // Effects before interactions (CEI pattern).
        report.status = ReportStatus::Paid;
        report.reward_amount = 0;
        report.updated_at = env.ledger().timestamp();
        clear_open_report_flag(&env, &reporter);
        set_report(&env, &report);

        // Interaction: transfer tokens to reporter.
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &reporter, &payout);

        env.events()
            .publish((symbol_short!("paid"),), (reporter, report_id, payout));

        Ok(payout)
    }

    // ── Reporter self-withdrawal ──────────────────────────────────────────────

    /// Withdraw a Pending report. Only the original reporter may call this.
    pub fn withdraw_report(env: Env, reporter: Address, report_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        reporter.require_auth();

        let mut report = get_report(&env, report_id)?;

        if report.reporter != reporter {
            return Err(Error::Unauthorized);
        }
        if report.status != ReportStatus::Pending {
            return Err(Error::InvalidStatus);
        }

        report.status = ReportStatus::Withdrawn;
        report.updated_at = env.ledger().timestamp();
        clear_open_report_flag(&env, &reporter);
        set_report(&env, &report);

        env.events()
            .publish((symbol_short!("withdrawn"),), (reporter, report_id));

        Ok(())
    }

    // ── Emergency controls ────────────────────────────────────────────────────

    /// Pause or unpause the contract. Admin only.
    ///
    /// When paused, new submissions and triage actions are blocked.
    /// Existing accepted reports can still be claimed.
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_paused(&env, paused);

        env.events()
            .publish((symbol_short!("paused"),), paused);

        Ok(())
    }

    /// Withdraw remaining pool funds to the admin. Admin only.
    ///
    /// Intended for emergency recovery or program termination.
    pub fn emergency_withdraw(
        env: Env,
        admin: Address,
        token_address: Address,
        amount: i128,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;

        let pool = get_pool_balance(&env);
        if amount > pool {
            return Err(Error::InsufficientPool);
        }

        // Effects before interactions.
        set_pool_balance(&env, pool - amount);

        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &admin, &amount);

        env.events()
            .publish((symbol_short!("emrg_wd"),), (admin, amount));

        Ok(())
    }

    // ── Admin management ──────────────────────────────────────────────────────

    /// Transfer admin role to a new address. Current admin only.
    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_admin(&env, &new_admin);

        env.events()
            .publish((symbol_short!("adm_xfer"),), new_admin);

        Ok(())
    }

    /// Update the reward amount for a severity tier. Admin only.
    pub fn set_reward_tier(
        env: Env,
        admin: Address,
        severity: Severity,
        amount: i128,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::ZeroReward);
        }
        set_reward_for_severity(&env, severity, amount);

        env.events()
            .publish((symbol_short!("tier_upd"),), (severity as u32, amount));

        Ok(())
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Return a report by ID.
    pub fn get_report(env: Env, report_id: u32) -> Result<Report, Error> {
        ensure_initialized(&env)?;
        get_report(&env, report_id)
    }

    /// Return the total number of reports submitted.
    pub fn report_count(env: Env) -> u32 {
        get_report_count(&env)
    }

    /// Return the current bounty pool balance in stroops.
    pub fn pool_balance(env: Env) -> i128 {
        get_pool_balance(&env)
    }

    /// Return whether the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Return whether the contract has been initialised.
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Return the configured reward for a severity tier.
    pub fn reward_for_severity(env: Env, severity: Severity) -> i128 {
        get_reward_for_severity(&env, severity)
    }

    /// Return whether a reporter currently has an open report.
    pub fn has_open_report(env: Env, reporter: Address) -> bool {
        has_open_report(&env, &reporter)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    ensure_initialized(env)?;
    caller.require_auth();
    let admin = get_admin(env)?;
    if *caller != admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
