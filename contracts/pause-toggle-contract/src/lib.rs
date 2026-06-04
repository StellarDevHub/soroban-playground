// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Pause Toggle Contract
//!
//! Emergency circuit-breaker pattern for Soroban smart contracts.
//!
//! ## Features
//! - `init` / `pause` / `unpause` lifecycle
//! - `get_pause_reason` — retrieve why the contract was paused
//! - `get_pause_timestamp` — retrieve when the contract was paused
//! - Admin-only control via `require_auth()`
//! - Event emissions: `init`, `paused`, `unpaused`
//! - Guarded action example via `do_action`

#![cfg_attr(not(test), no_std)]

mod test;

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, String};

// ── Error types ───────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Caller is not the admin.
    Unauthorized = 1,
    /// Action blocked because contract is paused.
    ContractPaused = 2,
    /// Contract is already in the requested state.
    AlreadyInState = 3,
    /// Contract has not been initialized yet.
    NotInitialized = 4,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    PauseReason,
    PauseTimestamp,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PauseToggle;

#[contractimpl]
impl PauseToggle {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    /// Initializes the contract with an admin address.
    /// Sets the contract to unpaused by default. Panics if already initialized.
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events()
            .publish((soroban_sdk::symbol_short!("init"),), admin);
    }

    // ── Pause controls ────────────────────────────────────────────────────────

    /// Pauses the contract with an optional reason string.
    ///
    /// # Errors
    /// - `NotInitialized` — if `init` has not been called.
    /// - `Unauthorized` — if caller is not the admin.
    /// - `AlreadyInState` — if already paused.
    pub fn pause(env: Env, caller: Address, reason: Option<String>) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_initialized(&env)?;
        Self::assert_admin(&env, &caller)?;

        if Self::is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &true);

        let now = env.ledger().timestamp();
        env.storage()
            .instance()
            .set(&DataKey::PauseTimestamp, &now);

        if let Some(r) = &reason {
            env.storage().instance().set(&DataKey::PauseReason, r);
        }

        env.events()
            .publish((soroban_sdk::symbol_short!("paused"),), (caller, now));

        Ok(())
    }

    /// Unpauses the contract.
    ///
    /// # Errors
    /// - `NotInitialized` — if `init` has not been called.
    /// - `Unauthorized` — if caller is not the admin.
    /// - `AlreadyInState` — if already unpaused.
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        Self::assert_initialized(&env)?;
        Self::assert_admin(&env, &caller)?;

        if !Self::is_paused(&env) {
            return Err(Error::AlreadyInState);
        }

        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().remove(&DataKey::PauseReason);
        env.storage().instance().remove(&DataKey::PauseTimestamp);

        env.events()
            .publish((soroban_sdk::symbol_short!("unpaused"),), caller);

        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Returns `true` if the contract is currently paused.
    pub fn paused(env: Env) -> bool {
        Self::is_paused(&env)
    }

    /// Returns the reason the contract was paused, if one was recorded.
    /// Returns `None` when not paused or when no reason was given.
    pub fn get_pause_reason(env: Env) -> Option<String> {
        env.storage()
            .instance()
            .get(&DataKey::PauseReason)
    }

    /// Returns the ledger timestamp at which the contract was paused.
    /// Returns `None` when not paused.
    pub fn get_pause_timestamp(env: Env) -> Option<u64> {
        env.storage()
            .instance()
            .get(&DataKey::PauseTimestamp)
    }

    /// Returns the current admin address.
    ///
    /// # Errors
    /// - `NotInitialized` — if `init` has not been called.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    // ── Guarded action ────────────────────────────────────────────────────────

    /// Example guarded action — blocked when paused.
    ///
    /// Replace with real business logic. Any function that should be halted
    /// during an emergency calls `is_paused` first.
    ///
    /// # Errors
    /// - `ContractPaused` — if the contract is paused.
    pub fn do_action(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        if Self::is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        env.events()
            .publish((soroban_sdk::symbol_short!("action"),), caller);
        Ok(())
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    fn is_paused(env: &Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if &admin != caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }
}
