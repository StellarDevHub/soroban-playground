// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Bug Bounty Contract
//!
//! Manages vulnerability disclosure reports with severity-based rewards,
//! lifecycle tracking, and an emergency pause mechanism.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    clear_open_report_flag, get_admin, get_pool_balance, get_report, get_report_count,
    get_reward_for_severity, has_open_report, is_initialized, is_paused, set_admin,
    set_open_report_flag, set_paused, set_pool_balance, set_report, set_report_count,
    set_reward_for_severity,
};
use crate::types::{Error, InstanceKey, Report, ReportStatus, Severity};

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
        let balance = get_pool_balance(&env);
        set_pool_balance(&env, balance + amount);
        Ok(())
    }

    /// Override the default reward for a severity tier (admin only).
    pub fn set_reward(env: Env, admin: Address, severity: Severity, amount: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount == 0 {
            return Err(Error::ZeroReward);
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
        reporter.require_auth();

        if title.len() == 0 {
            return Err(Error::EmptyTitle);
        }
        if description_hash.len() == 0 {
            return Err(Error::EmptyDescriptionHash);
        }
        if has_open_report(&env, &reporter) {
            return Err(Error::AlreadyHasOpenReport);
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
        };

        set_report(&env, &report);
        set_report_count(&env, id);
        set_open_report_flag(&env, &reporter);

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

        let reward = get_reward_for_severity(&env, report.severity);
        let pool = get_pool_balance(&env);
        if pool < reward {
            return Err(Error::InsufficientPool);
        }

        report.status = ReportStatus::Accepted;
        report.reward_amount = reward;
        report.updated_at = env.ledger().timestamp();
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

        report.status = ReportStatus::Rejected;
        report.updated_at = env.ledger().timestamp();
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

    // ── Internal helpers ──────────────────────────────────────────────────────

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
