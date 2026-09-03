// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Common Utilities
//!
//! Standardized Soroban helpers shared across the workspace's stateful
//! contracts. The primary helper is [`storage::StorageManager`], which wraps
//! instance / persistent / temporary storage access and **automatically
//! extends the storage TTL** on every read and write (threshold 100,000
//! ledgers ≈ 5.7 days, extend-to 500,000 ledgers ≈ 28 days).
//!
//! ```rust,ignore
//! use common_utils::storage::StorageManager;
//!
//! let sm = StorageManager::new(&env);
//! sm.instance_set(&DataKey::Reserve0, &reserve0);
//! ```
//!
//! The `CommonUtils` contract below is a thin demonstration layer so the
//! manager can be exercised end-to-end and its TTL behavior verified in tests.

#![no_std]

pub mod storage;
mod test;

use soroban_sdk::{contract, contractimpl, Env, Symbol};

use crate::storage::{EXTEND_LIMIT, LEDGER_THRESHOLD, StorageManager};

#[contract]
pub struct CommonUtils;

#[contractimpl]
impl CommonUtils {
    /// Returns the TTL renewal threshold in ledgers (~100k ledgers / ~5.7 days).
    pub fn ledger_threshold(_env: Env) -> u32 {
        LEDGER_THRESHOLD
    }

    /// Returns the TTL extend-to limit in ledgers (~500k ledgers / ~28 days).
    pub fn extend_limit(_env: Env) -> u32 {
        EXTEND_LIMIT
    }

    /// Write + TTL-extend a value into instance storage.
    pub fn instance_write(env: Env, key: Symbol, value: i128) {
        StorageManager::new(&env).instance_set(&key, &value);
    }

    /// Read (and TTL-extend) a value from instance storage.
    pub fn instance_read(env: Env, key: Symbol) -> i128 {
        StorageManager::new(&env).instance_get(&key).unwrap_or(0)
    }

    /// Write + TTL-extend a value into persistent storage.
    pub fn persistent_write(env: Env, key: Symbol, value: i128) {
        StorageManager::new(&env).persistent_set(&key, &value);
    }

    /// Read (and TTL-extend) a value from persistent storage.
    pub fn persistent_read(env: Env, key: Symbol) -> i128 {
        StorageManager::new(&env).persistent_get(&key).unwrap_or(0)
    }
}