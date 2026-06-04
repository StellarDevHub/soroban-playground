// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Access Control Contract  (Issue #594)
//!
//! Provides flexible, role-based permission management for Soroban applications.
//!
//! ## Roles
//! Roles are stored as `u32` discriminants. The `Role` enum provides five
//! built-in roles (`Admin`, `Minter`, `Burner`, `Pauser`, `Upgrader`);
//! any custom `u32` value is also valid for application-specific roles.
//!
//! ## Lifecycle
//! 1. Owner calls `initialize` (once). Owner implicitly holds `Role::Admin`.
//! 2. Owner grants roles to addresses via `grant_role`.
//! 3. Role holders use `require_role` to gate their own logic.
//! 4. Owner or Admin can `revoke_role`.
//! 5. Owner can `transfer_ownership`.
//! 6. `Pauser` role holders (or owner) can `pause`/`unpause`.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    get_owner, has_role, is_initialized, is_paused, set_owner, set_paused, set_role,
};
use crate::types::Role;

/// Errors returned by the access-control contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    RoleAlreadyGranted = 5,
    RoleNotHeld = 6,
}

#[contract]
pub struct AccessControl;

#[contractimpl]
impl AccessControl {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract. Owner automatically receives `Role::Admin`.
    pub fn initialize(env: Env, owner: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        owner.require_auth();
        set_owner(&env, &owner);
        set_role(&env, &owner, Role::Admin as u32, true);
        env.events().publish((symbol_short!("init"),), owner);
        Ok(())
    }

    // ── Ownership ─────────────────────────────────────────────────────────────

    /// Transfer contract ownership. Previous owner loses the Admin role;
    /// new owner gains it.
    pub fn transfer_ownership(env: Env, owner: Address, new_owner: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();
        require_owner(&env, &owner)?;

        set_role(&env, &owner, Role::Admin as u32, false);
        set_owner(&env, &new_owner);
        set_role(&env, &new_owner, Role::Admin as u32, true);

        env.events()
            .publish((symbol_short!("xfer"),), (owner, new_owner));
        Ok(())
    }

    // ── Pause / Unpause ───────────────────────────────────────────────────────

    /// Pause the contract. Requires the caller to hold `Role::Pauser` or be owner.
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner_or_role(&env, &caller, Role::Pauser)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), caller);
        Ok(())
    }

    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner_or_role(&env, &caller, Role::Pauser)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), caller);
        Ok(())
    }

    // ── Role management ───────────────────────────────────────────────────────

    /// Grant a role to an address. Owner or Admin only.
    pub fn grant_role(env: Env, caller: Address, grantee: Address, role: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        caller.require_auth();
        require_owner_or_role(&env, &caller, Role::Admin)?;

        if has_role(&env, &grantee, role) {
            return Err(Error::RoleAlreadyGranted);
        }
        set_role(&env, &grantee, role, true);
        env.events()
            .publish((symbol_short!("granted"),), (grantee, role));
        Ok(())
    }

    /// Revoke a role from an address. Owner or Admin only.
    pub fn revoke_role(env: Env, caller: Address, target: Address, role: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        caller.require_auth();
        require_owner_or_role(&env, &caller, Role::Admin)?;

        if !has_role(&env, &target, role) {
            return Err(Error::RoleNotHeld);
        }
        set_role(&env, &target, role, false);
        env.events()
            .publish((symbol_short!("revoked"),), (target, role));
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn has_role(env: Env, addr: Address, role: u32) -> bool {
        has_role(&env, &addr, role)
    }

    pub fn get_owner(env: Env) -> Result<Address, Error> {
        get_owner(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
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

fn require_owner(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_owner(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn require_owner_or_role(env: &Env, caller: &Address, role: Role) -> Result<(), Error> {
    let owner = get_owner(env)?;
    if *caller == owner || has_role(env, caller, role as u32) {
        return Ok(());
    }
    Err(Error::Unauthorized)
}
