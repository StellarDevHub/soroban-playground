// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Emergency Pause Contract
//!
//! Multi-role circuit breaker for Soroban smart contracts.
//!
//! ## Roles
//! - **Guardian** — can pause immediately when an exploit is detected and can
//!   cancel a pending unpause.
//! - **Admin** — a configurable multi-signature set (threshold >= 2). Admins
//!   control role management, the unpause schedule, and the final unpause.
//!
//! ## Safety rails
//! - Every unpause goes through a mandatory 24-hour timelock.
//! - Users may recover their own base collateral after the contract has been
//!   continuously paused for more than 14 days.
#![cfg_attr(not(test), no_std)]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, String, Symbol, Vec};

use crate::storage::{
    clear_pause_reason, clear_pause_timestamp, clear_unpause_eta, get_admin_threshold, get_admins,
    get_balance, get_guardians, get_pause_reason, get_pause_timestamp, get_token, get_unpause_eta,
    is_admin, is_guardian, is_initialized, is_paused, set_admin_threshold, set_admins, set_balance,
    set_guardians, set_pause_reason, set_pause_timestamp, set_paused, set_token, set_unpause_eta,
};
use crate::types::Error;

/// Mandatory delay between scheduling and executing an unpause.
pub const UNPAUSE_TIMELOCK_SECS: u64 = 86_400;

/// Continuous-pause duration after which users may recover base collateral.
pub const EMERGENCY_WITHDRAW_DELAY_SECS: u64 = 14 * 86_400;

#[contract]
pub struct EmergencyPause;

#[contractimpl]
impl EmergencyPause {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialize the contract with a multi-sig admin set and threshold.
    ///
    /// The threshold must be at least 2 and no greater than the number of
    /// distinct admins. Every initial admin must authorize initialization.
    pub fn initialize(env: Env, admins: Vec<Address>, threshold: u32) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }

        Self::validate_admin_config(&env, &admins, threshold)?;

        for admin in admins.iter() {
            admin.require_auth();
        }

        set_admins(&env, &admins);
        set_admin_threshold(&env, threshold);
        set_guardians(&env, &Vec::new(&env));
        set_paused(&env, false);
        clear_pause_reason(&env);
        clear_pause_timestamp(&env);
        clear_unpause_eta(&env);

        env.events()
            .publish((symbol_short!("init"),), (admins, threshold));

        Ok(())
    }

    /// Alias for [`Self::initialize`].
    pub fn init(env: Env, admins: Vec<Address>, threshold: u32) -> Result<(), Error> {
        Self::initialize(env, admins, threshold)
    }

    // ── Guardian management (multi-sig admin only) ────────────────────────────

    /// Add a guardian. Requires the full multi-sig admin quorum.
    pub fn add_guardian(env: Env, signers: Vec<Address>, guardian: Address) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        let mut guardians = get_guardians(&env);
        if guardians.contains(&guardian) {
            return Err(Error::GuardianAlreadyAdded);
        }

        guardians.push_back(guardian.clone());
        set_guardians(&env, &guardians);

        env.events().publish((symbol_short!("guardian"),), guardian);

        Ok(())
    }

    /// Remove a guardian. Requires the full multi-sig admin quorum.
    pub fn remove_guardian(
        env: Env,
        signers: Vec<Address>,
        guardian: Address,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        let mut guardians = get_guardians(&env);
        let index = Self::index_of(&guardians, &guardian).ok_or(Error::GuardianNotFound)?;
        guardians.remove(index);
        set_guardians(&env, &guardians);

        env.events().publish((symbol_short!("un_guard"),), guardian);

        Ok(())
    }

    /// Check if an address is an active guardian.
    pub fn is_guardian(env: Env, addr: Address) -> bool {
        is_guardian(&env, &addr)
    }

    /// Get the current guardian set.
    pub fn get_guardians(env: Env) -> Vec<Address> {
        get_guardians(&env)
    }

    /// Get the current guardian count.
    pub fn guardian_count(env: Env) -> u32 {
        get_guardians(&env).len()
    }

    // ── Admin management (multi-sig admin only) ───────────────────────────────

    /// Add an admin signer. Requires the current multi-sig admin quorum.
    pub fn add_admin(env: Env, signers: Vec<Address>, admin: Address) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        let mut admins = get_admins(&env);
        if admins.contains(&admin) {
            return Err(Error::AdminAlreadyAdded);
        }

        admins.push_back(admin.clone());
        set_admins(&env, &admins);

        env.events().publish((symbol_short!("admin"),), admin);

        Ok(())
    }

    /// Remove an admin signer. Requires the current multi-sig admin quorum and
    /// must not leave fewer admins than the configured threshold.
    pub fn remove_admin(env: Env, signers: Vec<Address>, admin: Address) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        let mut admins = get_admins(&env);
        let index = Self::index_of(&admins, &admin).ok_or(Error::AdminNotFound)?;

        let threshold = get_admin_threshold(&env)?;
        if admins.len().saturating_sub(1) < threshold {
            return Err(Error::InvalidThreshold);
        }

        admins.remove(index);
        set_admins(&env, &admins);

        env.events().publish((symbol_short!("un_admin"),), admin);

        Ok(())
    }

    /// Replace the entire admin signer set and threshold.
    /// Requires the current multi-sig admin quorum.
    pub fn set_admins(
        env: Env,
        signers: Vec<Address>,
        new_admins: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;
        Self::validate_admin_config(&env, &new_admins, new_threshold)?;

        set_admins(&env, &new_admins);
        set_admin_threshold(&env, new_threshold);

        env.events()
            .publish((symbol_short!("admins"),), (new_admins, new_threshold));

        Ok(())
    }

    /// Alias for [`Self::set_admins`].
    pub fn update_admins(
        env: Env,
        signers: Vec<Address>,
        new_admins: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), Error> {
        Self::set_admins(env, signers, new_admins, new_threshold)
    }

    /// Update the multi-sig admin threshold. Requires admin quorum.
    pub fn set_admin_threshold(
        env: Env,
        signers: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        let admins = get_admins(&env);
        Self::validate_threshold(new_threshold, admins.len())?;

        set_admin_threshold(&env, new_threshold);

        env.events()
            .publish((symbol_short!("thresh"),), new_threshold);

        Ok(())
    }

    /// Backwards-compatible alias for [`Self::set_admin_threshold`].
    pub fn set_threshold(env: Env, signers: Vec<Address>, new_threshold: u32) -> Result<(), Error> {
        Self::set_admin_threshold(env, signers, new_threshold)
    }

    /// Check if an address is an admin signer.
    pub fn is_admin(env: Env, addr: Address) -> bool {
        is_admin(&env, &addr)
    }

    /// Get the current admin signer set.
    pub fn get_admins(env: Env) -> Vec<Address> {
        get_admins(&env)
    }

    /// Get the first admin address (legacy single-admin accessor).
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admins(&env).get(0).ok_or(Error::NotInitialized)
    }

    /// Get the current admin count.
    pub fn admin_count(env: Env) -> u32 {
        get_admins(&env).len()
    }

    /// Get the current multi-sig admin threshold.
    pub fn get_admin_threshold(env: Env) -> Result<u32, Error> {
        get_admin_threshold(&env)
    }

    /// Backwards-compatible alias for [`Self::get_admin_threshold`].
    pub fn get_threshold(env: Env) -> Result<u32, Error> {
        get_admin_threshold(&env)
    }

    // ── Pause / unpause lifecycle ─────────────────────────────────────────────

    /// Immediately pause the contract. Callable by an active guardian or admin.
    /// Re-pausing refreshes `paused_at` and cancels any pending unpause.
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        Self::pause_internal(&env, caller, None)
    }

    /// Immediately pause the contract and record a public reason.
    pub fn pause_with_reason(env: Env, caller: Address, reason: String) -> Result<(), Error> {
        Self::pause_internal(&env, caller, Some(reason))
    }

    /// Schedule an unpause after the mandatory 24-hour timelock.
    /// Requires the full multi-sig admin quorum and a paused contract.
    pub fn schedule_unpause(env: Env, signers: Vec<Address>) -> Result<u64, Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        if !is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        let now = env.ledger().timestamp();
        let eta = now
            .checked_add(UNPAUSE_TIMELOCK_SECS)
            .ok_or(Error::Overflow)?;
        set_unpause_eta(&env, eta);

        env.events()
            .publish((Symbol::new(&env, "unpause_scheduled"),), eta);

        Ok(eta)
    }

    /// Cancel a pending unpause. Callable by a guardian or admin when an
    /// exploit is still active.
    pub fn cancel_unpause(env: Env, caller: Address) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        caller.require_auth();

        if !is_guardian(&env, &caller) && !is_admin(&env, &caller) {
            return Err(Error::Unauthorized);
        }

        if get_unpause_eta(&env).is_none() {
            return Err(Error::NoPendingUnpause);
        }

        clear_unpause_eta(&env);

        env.events()
            .publish((Symbol::new(&env, "unpause_cancelled"),), caller);

        Ok(())
    }

    /// Execute a scheduled unpause once the 24-hour timelock has elapsed.
    /// Requires the full multi-sig admin quorum.
    pub fn execute_unpause(env: Env, signers: Vec<Address>) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        if !is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        let eta = get_unpause_eta(&env).ok_or(Error::NoPendingUnpause)?;
        let now = env.ledger().timestamp();
        if now < eta {
            return Err(Error::TimeLockNotExpired);
        }

        set_paused(&env, false);
        clear_pause_timestamp(&env);
        clear_pause_reason(&env);
        clear_unpause_eta(&env);

        env.events().publish((symbol_short!("unpaused"),), now);

        Ok(())
    }

    // ── Base collateral / emergency withdrawals ───────────────────────────────

    /// Configure the token used for collateral transfers. Admin quorum only.
    pub fn set_token(env: Env, signers: Vec<Address>, token: Address) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        Self::assert_admin_quorum(&env, &signers)?;

        set_token(&env, &token);

        env.events().publish((symbol_short!("token"),), token);

        Ok(())
    }

    /// Record base collateral for `user`. If a token has been configured, the
    /// collateral is pulled into this contract first.
    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let current = get_balance(&env, &user);
        let updated = current.checked_add(amount).ok_or(Error::Overflow)?;

        if let Some(token_addr) = get_token(&env) {
            token::Client::new(&env, &token_addr).transfer(
                &user,
                &env.current_contract_address(),
                &amount,
            );
        }

        set_balance(&env, &user, updated);

        env.events()
            .publish((symbol_short!("deposit"),), (user, amount));

        Ok(())
    }

    /// Withdraw the caller's own base collateral after more than 14 days of
    /// continuous pause.
    ///
    /// Checks-effects-interactions: the balance is zeroed before the external
    /// token transfer, preventing reentrancy / double-withdrawal.
    pub fn emergency_withdraw(env: Env, user: Address) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();

        if !is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        let paused_at = get_pause_timestamp(&env).ok_or(Error::AlreadyInState)?;
        let withdraw_after = paused_at
            .checked_add(EMERGENCY_WITHDRAW_DELAY_SECS)
            .ok_or(Error::Overflow)?;

        if env.ledger().timestamp() <= withdraw_after {
            return Err(Error::EmergencyWithdrawNotAllowed);
        }

        let amount = get_balance(&env, &user);
        if amount <= 0 {
            return Err(Error::InsufficientBalance);
        }

        // Effects before interactions.
        set_balance(&env, &user, 0);

        if let Some(token_addr) = get_token(&env) {
            token::Client::new(&env, &token_addr).transfer(
                &env.current_contract_address(),
                &user,
                &amount,
            );
        }

        env.events()
            .publish((Symbol::new(&env, "emergency_withdrawal"),), (user, amount));

        Ok(amount)
    }

    /// Returns a user's tracked base collateral balance.
    pub fn balance(env: Env, user: Address) -> i128 {
        get_balance(&env, &user)
    }

    /// Returns the configured collateral token, if any.
    pub fn get_token(env: Env) -> Option<Address> {
        get_token(&env)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Returns `true` if the contract is currently paused.
    pub fn paused(env: Env) -> bool {
        is_paused(&env)
    }

    /// Returns the reason the contract was paused, if one was recorded.
    pub fn get_pause_reason(env: Env) -> Option<String> {
        get_pause_reason(&env)
    }

    /// Returns the ledger timestamp at which the contract was paused.
    pub fn get_pause_timestamp(env: Env) -> Option<u64> {
        get_pause_timestamp(&env)
    }

    /// Returns the scheduled unpause timestamp, if one is pending.
    pub fn get_unpause_eta(env: Env) -> Option<u64> {
        get_unpause_eta(&env)
    }

    // ── Guarded action ────────────────────────────────────────────────────────

    /// Example guarded action — blocked when paused.
    pub fn do_action(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        env.events().publish((symbol_short!("action"),), caller);
        Ok(())
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn pause_internal(env: &Env, caller: Address, reason: Option<String>) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();

        if !is_guardian(env, &caller) && !is_admin(env, &caller) {
            return Err(Error::Unauthorized);
        }

        let now = env.ledger().timestamp();
        set_paused(env, true);
        set_pause_timestamp(env, now);
        clear_unpause_eta(env);

        match reason {
            Some(value) => set_pause_reason(env, &value),
            None => clear_pause_reason(env),
        }

        env.events()
            .publish((symbol_short!("paused"),), (caller, now));

        Ok(())
    }

    fn assert_admin_quorum(env: &Env, signers: &Vec<Address>) -> Result<(), Error> {
        let threshold = get_admin_threshold(env)?;
        if threshold < 2 {
            return Err(Error::InvalidThreshold);
        }
        if signers.len() < threshold {
            return Err(Error::InsufficientSignatures);
        }

        let admins = get_admins(env);
        let mut seen = Vec::new(env);

        for signer in signers.iter() {
            if !admins.contains(&signer) {
                return Err(Error::Unauthorized);
            }
            if seen.contains(&signer) {
                return Err(Error::DuplicateSigner);
            }

            signer.require_auth();
            seen.push_back(signer);
        }

        if seen.len() < threshold {
            return Err(Error::InsufficientSignatures);
        }

        Ok(())
    }

    fn validate_admin_config(
        env: &Env,
        admins: &Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        Self::validate_threshold(threshold, admins.len())?;

        for i in 0..admins.len() {
            let current = admins.get(i).ok_or(Error::InvalidThreshold)?;
            for j in (i + 1)..admins.len() {
                if current == admins.get(j).ok_or(Error::InvalidThreshold)? {
                    return Err(Error::DuplicateSigner);
                }
            }
        }

        let _ = env;
        Ok(())
    }

    fn validate_threshold(threshold: u32, signer_count: u32) -> Result<(), Error> {
        if threshold < 2 || threshold > signer_count {
            return Err(Error::InvalidThreshold);
        }
        Ok(())
    }

    fn index_of(values: &Vec<Address>, target: &Address) -> Option<u32> {
        for i in 0..values.len() {
            if let Some(value) = values.get(i) {
                if &value == target {
                    return Some(i);
                }
            }
        }
        None
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }
}
