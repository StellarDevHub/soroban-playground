// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Versioned Contract  (Issue #588)
//!
//! Tracks the semantic version history of a Soroban application on-chain,
//! supports forward migrations and rollbacks, and persists an audit log of
//! every transition.
//!
//! ## Lifecycle
//! 1. Admin calls `initialize` with the initial version.
//! 2. Admin registers new versions via `register_version`.
//! 3. Admin calls `migrate_to_version(idx)` to move forward.
//! 4. Admin calls `rollback_to_version(idx)` to revert.
//! 5. Anyone can query `get_version`, `get_version_at`, `get_migration`.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contracterror, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_current_index, get_migration_count, get_version_count, is_initialized,
    load_migration, load_version, set_admin, set_current_index, set_migration_count,
    set_version_count, store_migration, store_version,
};
use crate::types::{MigrationRecord, Version};

/// Errors returned by the versioned contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    VersionNotFound = 4,
    AlreadyAtVersion = 5,
    MigrationNotFound = 6,
}

#[contract]
pub struct VersionedContract;

#[contractimpl]
impl VersionedContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise with the first version. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        major: u32,
        minor: u32,
        patch: u32,
        label: String,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);

        let v = Version { major, minor, patch, label };
        store_version(&env, 0, &v);
        set_version_count(&env, 1);
        set_current_index(&env, 0);

        env.events().publish((symbol_short!("init"),), (admin, major, minor, patch));
        Ok(())
    }

    // ── Version registry ──────────────────────────────────────────────────────

    /// Register a new version in the history. Admin only. Returns its index.
    pub fn register_version(
        env: Env,
        admin: Address,
        major: u32,
        minor: u32,
        patch: u32,
        label: String,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let idx = get_version_count(&env);
        let v = Version { major, minor, patch, label };
        store_version(&env, idx, &v);
        set_version_count(&env, idx + 1);

        env.events().publish((symbol_short!("regver"),), (idx, major, minor, patch));
        Ok(idx)
    }

    // ── Migration / rollback ──────────────────────────────────────────────────

    /// Migrate to the version at `to_index`. Records a migration log entry.
    pub fn migrate_to_version(env: Env, admin: Address, to_index: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let current = get_current_index(&env);
        if current == to_index {
            return Err(Error::AlreadyAtVersion);
        }
        if to_index >= get_version_count(&env) {
            return Err(Error::VersionNotFound);
        }

        let rec = MigrationRecord {
            from_index: current,
            to_index,
            ledger: env.ledger().timestamp(),
        };
        let m_idx = get_migration_count(&env);
        store_migration(&env, m_idx, &rec);
        set_migration_count(&env, m_idx + 1);
        set_current_index(&env, to_index);

        env.events()
            .publish((symbol_short!("migrated"),), (current, to_index));
        Ok(())
    }

    /// Roll back to the version at `to_index`. Uses the same migration log.
    pub fn rollback_to_version(env: Env, admin: Address, to_index: u32) -> Result<(), Error> {
        Self::migrate_to_version(env, admin, to_index)
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_version(env: Env) -> Result<Version, Error> {
        ensure_initialized(&env)?;
        load_version(&env, get_current_index(&env))
    }

    pub fn get_version_at(env: Env, idx: u32) -> Result<Version, Error> {
        ensure_initialized(&env)?;
        load_version(&env, idx)
    }

    pub fn get_version_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_version_count(&env))
    }

    pub fn get_current_index(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_current_index(&env))
    }

    pub fn get_migration(env: Env, idx: u32) -> Result<MigrationRecord, Error> {
        ensure_initialized(&env)?;
        load_migration(&env, idx)
    }

    pub fn get_migration_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_migration_count(&env))
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

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
