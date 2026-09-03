// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # StorageManager
//!
//! A standardized helper that wraps Soroban contract storage access and
//! **automatically extends the TTL** of every entry on both *read* and *write*
//! operations. Without TTL extension, stateful contract storage is archived
//! after its TTL expires on Stellar Mainnet, permanently locking funds and
//! making the contract unusable.
//!
//! Usage:
//! ```rust,ignore
//! use common_utils::storage::StorageManager;
//!
//! let sm = StorageManager::new(&env);
//! sm.instance_set(&DataKey::Admin, &admin);        // writes + extends TTL
//! let admin: Address = sm.instance_get(&DataKey::Admin).unwrap(); // reads + extends TTL
//! sm.persistent_set(&DataKey::User(user), &amount);
//! ```

use soroban_sdk::{Env, IntoVal, TryFromVal, Val};

/// Number of ledgers below which an entry's TTL is considered almost-expired
/// and is bumped back up. 100,000 ledgers ≈ ~5.7 days at 5s/ledger.
pub const LEDGER_THRESHOLD: u32 = 100_000;
/// Ledgers to extend an entry's live-until to when it falls below the
/// threshold. 500,000 ledgers ≈ ~28 days at 5s/ledger.
pub const EXTEND_LIMIT: u32 = 500_000;

/// Contract storage accessor that automatically extends storage TTL on every
/// read and write, so state never gets archived due to inactivity.
pub struct StorageManager {
    env: Env,
}

impl StorageManager {
    /// Create a manager bound to the calling contract environment.
    pub fn new(env: &Env) -> Self {
        Self { env: env.clone() }
    }

    // ── Instance storage ─────────────────────────────────────────────────────

    /// Returns whether an instance-storage entry exists.
    pub fn instance_has<K>(&self, key: &K) -> bool
    where
        K: IntoVal<Env, Val>,
    {
        self.env.storage().instance().has(key)
    }

    /// Reads an instance-storage entry and bumps the instance TTL on access.
    pub fn instance_get<K, V>(&self, key: &K) -> Option<V>
    where
        K: IntoVal<Env, Val> + Clone,
        V: TryFromVal<Env, Val>,
    {
        let val: Option<V> = self.env.storage().instance().get(key);
        if val.is_some() {
            self.bump_instance();
        }
        val
    }

    /// Writes an instance-storage entry and extends its TTL.
    pub fn instance_set<K, V>(&self, key: &K, value: &V)
    where
        K: IntoVal<Env, Val> + Clone,
        V: IntoVal<Env, Val>,
    {
        self.env.storage().instance().set(key, value);
        self.bump_instance();
    }

    /// Removes an instance-storage entry.
    pub fn instance_remove<K>(&self, key: &K)
    where
        K: IntoVal<Env, Val> + Clone,
    {
        self.env.storage().instance().remove(key);
    }

    /// Explicitly bumps all instance entries' TTL.
    pub fn bump_instance(&self) {
        self.env
            .storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, EXTEND_LIMIT);
    }

    // ── Persistent storage ───────────────────────────────────────────────────

    /// Returns whether a persistent-storage entry exists.
    pub fn persistent_has<K>(&self, key: &K) -> bool
    where
        K: IntoVal<Env, Val>,
    {
        self.env.storage().persistent().has(key)
    }

    /// Reads a persistent-storage entry and extends its TTL on access.
    pub fn persistent_get<K, V>(&self, key: &K) -> Option<V>
    where
        K: IntoVal<Env, Val> + Clone,
        V: TryFromVal<Env, Val>,
    {
        let val: Option<V> = self.env.storage().persistent().get(key);
        if val.is_some() {
            self.persistent_bump(key);
        }
        val
    }

    /// Writes a persistent-storage entry and extends its TTL.
    pub fn persistent_set<K, V>(&self, key: &K, value: &V)
    where
        K: IntoVal<Env, Val> + Clone,
        V: IntoVal<Env, Val>,
    {
        self.env.storage().persistent().set(key, value);
        self.persistent_bump(key);
    }

    /// Removes a persistent-storage entry.
    pub fn persistent_remove<K>(&self, key: &K)
    where
        K: IntoVal<Env, Val> + Clone,
    {
        self.env.storage().persistent().remove(key);
    }

    /// Explicitly extends a single persistent entry's TTL.
    pub fn persistent_bump<K>(&self, key: &K)
    where
        K: IntoVal<Env, Val> + Clone,
    {
        self.env
            .storage()
            .persistent()
            .extend_ttl(key, LEDGER_THRESHOLD, EXTEND_LIMIT);
    }

    // ── Temporary storage ────────────────────────────────────────────────────

    /// Returns whether a temporary-storage entry exists.
    pub fn temporary_has<K>(&self, key: &K) -> bool
    where
        K: IntoVal<Env, Val>,
    {
        self.env.storage().temporary().has(key)
    }

    /// Reads a temporary-storage entry and extends its TTL on access.
    pub fn temporary_get<K, V>(&self, key: &K) -> Option<V>
    where
        K: IntoVal<Env, Val> + Clone,
        V: TryFromVal<Env, Val>,
    {
        let val: Option<V> = self.env.storage().temporary().get(key);
        if val.is_some() {
            self.env
                .storage()
                .temporary()
                .extend_ttl(key, LEDGER_THRESHOLD, EXTEND_LIMIT);
        }
        val
    }

    /// Writes a temporary-storage entry and extends its TTL.
    pub fn temporary_set<K, V>(&self, key: &K, value: &V)
    where
        K: IntoVal<Env, Val> + Clone,
        V: IntoVal<Env, Val>,
    {
        self.env.storage().temporary().set(key, value);
        self.env
            .storage()
            .temporary()
            .extend_ttl(key, LEDGER_THRESHOLD, EXTEND_LIMIT);
    }

    /// Removes a temporary-storage entry.
    pub fn temporary_remove<K>(&self, key: &K)
    where
        K: IntoVal<Env, Val> + Clone,
    {
        self.env.storage().temporary().remove(key);
    }
}