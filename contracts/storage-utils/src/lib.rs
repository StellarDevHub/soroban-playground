// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Storage Utilities Contract
//!
//! Provides reusable, gas-efficient storage patterns for Soroban contracts:
//! - **StorageMap**: key-value mapping
//! - **StorageVec**: dynamic array with push/pop
//! - **StorageQueue**: FIFO queue
//! - **StorageStack**: LIFO stack
//! - **StorageSet**: unique-value set
//!
//! Each collection is namespaced by a `Symbol` prefix so multiple independent
//! collections can coexist in the same contract storage.

#![no_std]

mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

use crate::types::Error;

// ── Storage key helpers ───────────────────────────────────────────────────────

/// Returns the length key for a collection.
fn len_key(ns: &Symbol) -> (Symbol, Symbol) {
    (ns.clone(), symbol_short!("LEN"))
}

/// Returns the head key for a queue.
fn head_key(ns: &Symbol) -> (Symbol, Symbol) {
    (ns.clone(), symbol_short!("HEAD"))
}

/// Returns the element key at index `i`.
fn idx_key(ns: &Symbol, i: u32) -> (Symbol, u32) {
    (ns.clone(), i)
}

/// Returns the set-membership key for value `v`.
fn set_key(ns: &Symbol, v: i128) -> (Symbol, i128) {
    (ns.clone(), v)
}

// ── StorageMap helpers ────────────────────────────────────────────────────────

fn map_key(ns: &Symbol, k: i128) -> (Symbol, i128) {
    (ns.clone(), k)
}

#[contract]
pub struct StorageUtils;

#[contractimpl]
impl StorageUtils {
    // ── StorageMap ────────────────────────────────────────────────────────────

    /// Set a key-value pair in the named map.
    pub fn map_set(env: Env, ns: Symbol, key: i128, value: i128) {
        env.storage().persistent().set(&map_key(&ns, key), &value);
    }

    /// Get a value from the named map.
    pub fn map_get(env: Env, ns: Symbol, key: i128) -> Result<i128, Error> {
        env.storage()
            .persistent()
            .get(&map_key(&ns, key))
            .ok_or(Error::KeyNotFound)
    }

    /// Check if a key exists in the named map.
    pub fn map_has(env: Env, ns: Symbol, key: i128) -> bool {
        env.storage().persistent().has(&map_key(&ns, key))
    }

    /// Remove a key from the named map.
    pub fn map_remove(env: Env, ns: Symbol, key: i128) {
        env.storage().persistent().remove(&map_key(&ns, key));
    }

    // ── StorageVec ────────────────────────────────────────────────────────────

    /// Push a value onto the end of the named vector.
    pub fn vec_push(env: Env, ns: Symbol, value: i128) -> Result<u32, Error> {
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        let new_len = len.checked_add(1).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&idx_key(&ns, len), &value);
        env.storage().persistent().set(&len_key(&ns), &new_len);
        Ok(len)
    }

    /// Pop the last value from the named vector.
    pub fn vec_pop(env: Env, ns: Symbol) -> Result<i128, Error> {
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if len == 0 {
            return Err(Error::IndexOutOfBounds);
        }
        let last = len - 1;
        let val: i128 = env
            .storage()
            .persistent()
            .get(&idx_key(&ns, last))
            .ok_or(Error::IndexOutOfBounds)?;
        env.storage().persistent().remove(&idx_key(&ns, last));
        env.storage().persistent().set(&len_key(&ns), &last);
        Ok(val)
    }

    /// Get the value at index `i` in the named vector.
    pub fn vec_get(env: Env, ns: Symbol, index: u32) -> Result<i128, Error> {
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if index >= len {
            return Err(Error::IndexOutOfBounds);
        }
        env.storage()
            .persistent()
            .get(&idx_key(&ns, index))
            .ok_or(Error::IndexOutOfBounds)
    }

    /// Set the value at index `i` in the named vector.
    pub fn vec_set(env: Env, ns: Symbol, index: u32, value: i128) -> Result<(), Error> {
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if index >= len {
            return Err(Error::IndexOutOfBounds);
        }
        env.storage().persistent().set(&idx_key(&ns, index), &value);
        Ok(())
    }

    /// Return the length of the named vector.
    pub fn vec_len(env: Env, ns: Symbol) -> u32 {
        env.storage().persistent().get(&len_key(&ns)).unwrap_or(0)
    }

    // ── StorageQueue (FIFO) ───────────────────────────────────────────────────

    /// Enqueue a value into the named queue.
    pub fn queue_push(env: Env, ns: Symbol, value: i128) -> Result<(), Error> {
        let tail: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        let new_tail = tail.checked_add(1).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&idx_key(&ns, tail), &value);
        env.storage().persistent().set(&len_key(&ns), &new_tail);
        Ok(())
    }

    /// Dequeue the front value from the named queue.
    pub fn queue_pop(env: Env, ns: Symbol) -> Result<i128, Error> {
        let head: u32 = env.storage().persistent().get(&head_key(&ns)).unwrap_or(0);
        let tail: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if head >= tail {
            return Err(Error::QueueEmpty);
        }
        let val: i128 = env
            .storage()
            .persistent()
            .get(&idx_key(&ns, head))
            .ok_or(Error::QueueEmpty)?;
        env.storage().persistent().remove(&idx_key(&ns, head));
        env.storage().persistent().set(&head_key(&ns), &(head + 1));
        Ok(val)
    }

    /// Peek at the front value without removing it.
    pub fn queue_peek(env: Env, ns: Symbol) -> Result<i128, Error> {
        let head: u32 = env.storage().persistent().get(&head_key(&ns)).unwrap_or(0);
        let tail: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if head >= tail {
            return Err(Error::QueueEmpty);
        }
        env.storage()
            .persistent()
            .get(&idx_key(&ns, head))
            .ok_or(Error::QueueEmpty)
    }

    /// Return the number of elements in the named queue.
    pub fn queue_len(env: Env, ns: Symbol) -> u32 {
        let head: u32 = env.storage().persistent().get(&head_key(&ns)).unwrap_or(0);
        let tail: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        tail.saturating_sub(head)
    }

    // ── StorageStack (LIFO) ───────────────────────────────────────────────────

    /// Push a value onto the named stack.
    pub fn stack_push(env: Env, ns: Symbol, value: i128) -> Result<(), Error> {
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        let new_len = len.checked_add(1).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&idx_key(&ns, len), &value);
        env.storage().persistent().set(&len_key(&ns), &new_len);
        Ok(())
    }

    /// Pop the top value from the named stack.
    pub fn stack_pop(env: Env, ns: Symbol) -> Result<i128, Error> {
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if len == 0 {
            return Err(Error::StackEmpty);
        }
        let top = len - 1;
        let val: i128 = env
            .storage()
            .persistent()
            .get(&idx_key(&ns, top))
            .ok_or(Error::StackEmpty)?;
        env.storage().persistent().remove(&idx_key(&ns, top));
        env.storage().persistent().set(&len_key(&ns), &top);
        Ok(val)
    }

    /// Peek at the top value without removing it.
    pub fn stack_peek(env: Env, ns: Symbol) -> Result<i128, Error> {
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if len == 0 {
            return Err(Error::StackEmpty);
        }
        env.storage()
            .persistent()
            .get(&idx_key(&ns, len - 1))
            .ok_or(Error::StackEmpty)
    }

    /// Return the number of elements in the named stack.
    pub fn stack_len(env: Env, ns: Symbol) -> u32 {
        env.storage().persistent().get(&len_key(&ns)).unwrap_or(0)
    }

    // ── StorageSet ────────────────────────────────────────────────────────────

    /// Add a value to the named set. Returns true if it was newly added.
    pub fn set_add(env: Env, ns: Symbol, value: i128) -> bool {
        let key = set_key(&ns, value);
        if env.storage().persistent().has(&key) {
            return false;
        }
        env.storage().persistent().set(&key, &true);
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        env.storage().persistent().set(&len_key(&ns), &(len + 1));
        true
    }

    /// Check if a value is in the named set.
    pub fn set_has(env: Env, ns: Symbol, value: i128) -> bool {
        env.storage().persistent().has(&set_key(&ns, value))
    }

    /// Remove a value from the named set. Returns true if it was present.
    pub fn set_remove(env: Env, ns: Symbol, value: i128) -> bool {
        let key = set_key(&ns, value);
        if !env.storage().persistent().has(&key) {
            return false;
        }
        env.storage().persistent().remove(&key);
        let len: u32 = env.storage().persistent().get(&len_key(&ns)).unwrap_or(0);
        if len > 0 {
            env.storage().persistent().set(&len_key(&ns), &(len - 1));
        }
        true
    }

    /// Return the number of elements in the named set.
    pub fn set_len(env: Env, ns: Symbol) -> u32 {
        env.storage().persistent().get(&len_key(&ns)).unwrap_or(0)
    }
}
