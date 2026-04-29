// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Multi-Signature Wallet with RBAC
//!
//! Features:
//! - Configurable M-of-N threshold (e.g. 2-of-3, 3-of-5).
//! - Role-based access control: OWNER > ADMIN > OPERATOR > VIEWER.
//! - 24-hour timelock on queued transactions.
//! - Replay protection via per-signer approval tracking.
//! - Daily withdrawal limit.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

use crate::storage::{
    get_admin, get_daily_limit, get_daily_state, get_signer, get_signer_count, get_threshold,
    get_tx, get_tx_count, has_approved, has_signer, is_initialized, record_approval,
    remove_signer, role_of, set_admin, set_daily_limit, set_daily_state, set_signer,
    set_signer_count, set_threshold, set_tx, set_tx_count,
};
use crate::types::{Error, Role, Signer, Transaction, TxStatus};

/// 24-hour timelock in seconds.
const TIMELOCK_SECS: u64 = 86_400;
/// Proposal expiry: 7 days.
const EXPIRY_SECS: u64 = 604_800;

#[contract]
pub struct MultisigWallet;

#[contractimpl]
impl MultisigWallet {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the wallet with an owner, threshold, and optional daily limit.
    pub fn initialize(
        env: Env,
        owner: Address,
        threshold: u32,
        daily_limit: Option<i128>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        owner.require_auth();
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        set_admin(&env, &owner);
        set_threshold(&env, threshold);
        // Register the owner as the first signer.
        set_signer(&env, &Signer { address: owner, role: Role::Owner });
        set_signer_count(&env, 1);
        if let Some(limit) = daily_limit {
            set_daily_limit(&env, limit);
        }
        Ok(())
    }

    // ── Signer management ─────────────────────────────────────────────────────

    /// Add a new signer. Requires ADMIN or OWNER role.
    pub fn add_signer(env: Env, caller: Address, new_signer: Address, role: Role) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;

        if has_signer(&env, &new_signer) {
            return Err(Error::SignerAlreadyExists);
        }
        // Cannot assign a role higher than the caller's own role.
        if role > role_of(&env, &caller)? {
            return Err(Error::Unauthorized);
        }
        set_signer(&env, &Signer { address: new_signer, role });
        set_signer_count(&env, get_signer_count(&env) + 1);

        env.events().publish(
            (soroban_sdk::symbol_short!("add_sgn"),),
            role as u32,
        );
        Ok(())
    }

    /// Remove a signer. Requires OWNER role.
    pub fn remove_signer(env: Env, caller: Address, target: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Owner)?;

        if !has_signer(&env, &target) {
            return Err(Error::SignerNotFound);
        }
        let count = get_signer_count(&env);
        // Ensure threshold remains satisfiable.
        if count - 1 < get_threshold(&env) {
            return Err(Error::InvalidThreshold);
        }
        remove_signer(&env, &target);
        set_signer_count(&env, count - 1);

        env.events().publish(
            (soroban_sdk::symbol_short!("rm_sgn"),),
            target,
        );
        Ok(())
    }

    /// Change the approval threshold. Requires OWNER role.
    pub fn change_threshold(env: Env, caller: Address, new_threshold: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Owner)?;

        if new_threshold == 0 || new_threshold > get_signer_count(&env) {
            return Err(Error::InvalidThreshold);
        }
        set_threshold(&env, new_threshold);
        Ok(())
    }

    /// Update the daily withdrawal limit. Requires OWNER role.
    pub fn set_daily_limit(env: Env, caller: Address, limit: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Owner)?;
        set_daily_limit(&env, limit);
        Ok(())
    }

    // ── Transaction lifecycle ─────────────────────────────────────────────────

    /// Propose a new transaction. Any OPERATOR or above may propose.
    /// Returns the new transaction ID.
    pub fn propose(
        env: Env,
        proposer: Address,
        description: String,
        amount: i128,
        recipient: Option<Address>,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        proposer.require_auth();
        require_min_role(&env, &proposer, Role::Operator)?;

        if description.is_empty() {
            return Err(Error::EmptyDescription);
        }

        let now = env.ledger().timestamp();
        let id = get_tx_count(&env);
        let tx = Transaction {
            id,
            proposer,
            description,
            amount,
            recipient,
            status: TxStatus::Pending,
            approvals: 0,
            created_at: now,
            execute_after: now + TIMELOCK_SECS,
            expires_at: now + EXPIRY_SECS,
        };
        set_tx(&env, &tx);
        set_tx_count(&env, id + 1);

        env.events().publish(
            (soroban_sdk::symbol_short!("proposed"),),
            id,
        );
        Ok(id)
    }

    /// Approve a pending transaction. Any OPERATOR or above may approve.
    /// When approvals reach the threshold the tx moves to Queued.
    pub fn approve(env: Env, signer: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        signer.require_auth();
        require_min_role(&env, &signer, Role::Operator)?;

        let mut tx = get_tx(&env, tx_id)?;
        let now = env.ledger().timestamp();

        if tx.status != TxStatus::Pending {
            return Err(Error::TransactionNotPending);
        }
        if now > tx.expires_at {
            tx.status = TxStatus::Expired;
            set_tx(&env, &tx);
            return Err(Error::TransactionExpired);
        }
        if has_approved(&env, tx_id, &signer) {
            return Err(Error::AlreadyApproved);
        }

        record_approval(&env, tx_id, &signer);
        tx.approvals += 1;

        if tx.approvals >= get_threshold(&env) {
            tx.status = TxStatus::Queued;
            env.events().publish(
                (soroban_sdk::symbol_short!("queued"),),
                tx_id,
            );
        }
        set_tx(&env, &tx);
        Ok(())
    }

    /// Execute a queued transaction after the timelock has elapsed.
    /// Requires ADMIN or OWNER role.
    pub fn execute(env: Env, caller: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;

        let mut tx = get_tx(&env, tx_id)?;
        let now = env.ledger().timestamp();

        if tx.status != TxStatus::Queued {
            return Err(Error::TransactionNotQueued);
        }
        if now < tx.execute_after {
            return Err(Error::TimelockActive);
        }
        if now > tx.expires_at {
            tx.status = TxStatus::Expired;
            set_tx(&env, &tx);
            return Err(Error::TransactionExpired);
        }

        // Enforce daily withdrawal limit for XLM transfers.
        if tx.amount > 0 {
            check_and_update_daily_limit(&env, tx.amount)?;
        }

        tx.status = TxStatus::Executed;
        set_tx(&env, &tx);

        env.events().publish(
            (soroban_sdk::symbol_short!("executed"),),
            tx_id,
        );
        Ok(())
    }

    /// Cancel a pending or queued transaction. Requires ADMIN or OWNER role.
    pub fn cancel(env: Env, caller: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_min_role(&env, &caller, Role::Admin)?;

        let mut tx = get_tx(&env, tx_id)?;
        if tx.status != TxStatus::Pending && tx.status != TxStatus::Queued {
            return Err(Error::TransactionNotPending);
        }
        tx.status = TxStatus::Cancelled;
        set_tx(&env, &tx);

        env.events().publish(
            (soroban_sdk::symbol_short!("cancelled"),),
            tx_id,
        );
        Ok(())
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_threshold(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_threshold(&env))
    }

    pub fn get_signer_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_signer_count(&env))
    }

    pub fn get_signer(env: Env, addr: Address) -> Result<Signer, Error> {
        ensure_initialized(&env)?;
        get_signer(&env, &addr)
    }

    pub fn get_transaction(env: Env, tx_id: u32) -> Result<Transaction, Error> {
        ensure_initialized(&env)?;
        get_tx(&env, tx_id)
    }

    pub fn get_tx_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_tx_count(&env))
    }

    pub fn has_approved(env: Env, tx_id: u32, signer: Address) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(has_approved(&env, tx_id, &signer))
    }

    pub fn get_daily_limit(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_daily_limit(&env))
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_min_role(env: &Env, addr: &Address, min: Role) -> Result<(), Error> {
    if role_of(env, addr)? < min {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

/// Resets the daily counter if a new day has started, then checks the limit.
fn check_and_update_daily_limit(env: &Env, amount: i128) -> Result<(), Error> {
    const DAY_SECS: u64 = 86_400;
    let now = env.ledger().timestamp();
    let (mut withdrawn, day_start) = get_daily_state(env);

    if now >= day_start + DAY_SECS {
        withdrawn = 0;
    }

    let limit = get_daily_limit(env);
    if withdrawn + amount > limit {
        return Err(Error::DailyLimitExceeded);
    }

    let new_day_start = if now >= day_start + DAY_SECS { now } else { day_start };
    set_daily_state(env, withdrawn + amount, new_day_start);
    Ok(())
}
