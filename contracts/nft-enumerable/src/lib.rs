// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # NFT Enumerable Contract
//!
//! An ERC-721-style non-fungible token contract with full on-chain enumeration.
//!
//! ## Enumeration extensions
//!
//! | Function | Description |
//! |---|---|
//! | `total_supply()` | Total number of tokens in existence |
//! | `token_by_index(i)` | i-th token in the global list (0-based) |
//! | `token_of_owner_by_index(owner, i)` | i-th token owned by `owner` |
//!
//! ## Index shifting on burn
//!
//! When a token is burned the implementation uses **swap-and-pop** to remove it
//! from both the global list and the owner's list in O(1), without leaving gaps:
//!
//! 1. Find the index of the burned token.
//! 2. Swap the last element of the list into that position.
//! 3. Pop the last element (which is now a duplicate).
//!
//! This shifts the *last* token's index down by one.  Any code that iterates
//! indices should re-fetch the length after each burn.

#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    add_to_all_tokens, add_to_owner_tokens, get_all_tokens, get_approved, get_operator_approval,
    get_owner, get_owner_tokens, get_token_metadata, get_token_mint_count, is_initialized,
    remove_approved, remove_from_all_tokens, remove_from_owner_tokens, remove_owner,
    remove_token_metadata, set_admin, set_approved, set_operator_approval, set_owner,
    set_token_metadata, set_token_mint_count,
};
use crate::types::Error;

#[contract]
pub struct NftEnumerable;

#[contractimpl]
impl NftEnumerable {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    // ── Core NFT functions ────────────────────────────────────────────────────

    /// Mint a new token to `to`. Token IDs are auto-incremented.
    pub fn mint(env: Env, admin: Address, to: Address, metadata_uri: String) -> Result<u64, Error> {
        require_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let token_id = get_token_mint_count(&env);
        set_token_mint_count(&env, token_id + 1);

        set_owner(&env, token_id, &to);
        set_token_metadata(&env, token_id, &metadata_uri);

        // Add to global enumeration list
        add_to_all_tokens(&env, token_id);
        // Add to owner enumeration list
        add_to_owner_tokens(&env, &to, token_id);

        env.events()
            .publish((symbol_short!("mint"),), (token_id, to));
        Ok(token_id)
    }

    /// Transfer token `token_id` from `from` to `to`.
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        token_id: u64,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        spender.require_auth();

        let owner = get_owner(&env, token_id).ok_or(Error::TokenNotFound)?;
        if owner != from {
            return Err(Error::NotOwner);
        }

        // Check authorization: spender must be owner, approved, or operator.
        let approved = get_approved(&env, token_id);
        let is_operator = get_operator_approval(&env, &from, &spender);
        if spender != owner && Some(spender.clone()) != approved && !is_operator {
            return Err(Error::Unauthorized);
        }

        // Clear approval on transfer.
        remove_approved(&env, token_id);

        // Update enumeration: move token from `from` to `to`.
        remove_from_owner_tokens(&env, &from, token_id);
        add_to_owner_tokens(&env, &to, token_id);
        set_owner(&env, token_id, &to);

        env.events()
            .publish((symbol_short!("transfer"),), (token_id, from, to));
        Ok(())
    }

    /// Burn (permanently destroy) token `token_id`.
    ///
    /// Only the owner or an approved operator may burn.
    /// Uses swap-and-pop to maintain gap-free enumeration indices.
    pub fn burn(env: Env, caller: Address, token_id: u64) -> Result<(), Error> {
        require_initialized(&env)?;
        caller.require_auth();

        let owner = get_owner(&env, token_id).ok_or(Error::TokenNotFound)?;
        let approved = get_approved(&env, token_id);
        let is_operator = get_operator_approval(&env, &owner, &caller);
        if caller != owner && Some(caller.clone()) != approved && !is_operator {
            return Err(Error::Unauthorized);
        }

        // Remove from owner's enumeration list (swap-and-pop).
        remove_from_owner_tokens(&env, &owner, token_id);
        // Remove from global enumeration list (swap-and-pop).
        remove_from_all_tokens(&env, token_id);
        // Clear ownership, metadata, and approvals.
        remove_owner(&env, token_id);
        remove_token_metadata(&env, token_id);
        remove_approved(&env, token_id);

        env.events()
            .publish((symbol_short!("burn"),), (token_id, owner));
        Ok(())
    }

    /// Approve `spender` to transfer `token_id`.
    pub fn approve(
        env: Env,
        owner: Address,
        spender: Address,
        token_id: u64,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        owner.require_auth();

        let actual_owner = get_owner(&env, token_id).ok_or(Error::TokenNotFound)?;
        if actual_owner != owner {
            return Err(Error::NotOwner);
        }
        set_approved(&env, token_id, &spender);
        Ok(())
    }

    /// Set or revoke operator approval for `operator` to manage all tokens of `owner`.
    pub fn set_approval_for_all(
        env: Env,
        owner: Address,
        operator: Address,
        approved: bool,
    ) -> Result<(), Error> {
        require_initialized(&env)?;
        owner.require_auth();
        if owner == operator {
            return Err(Error::SelfApproval);
        }
        set_operator_approval(&env, &owner, &operator, approved);
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn owner_of(env: Env, token_id: u64) -> Result<Address, Error> {
        require_initialized(&env)?;
        get_owner(&env, token_id).ok_or(Error::TokenNotFound)
    }

    pub fn get_approved(env: Env, token_id: u64) -> Option<Address> {
        get_approved(&env, token_id)
    }

    pub fn is_approved_for_all(env: Env, owner: Address, operator: Address) -> bool {
        get_operator_approval(&env, &owner, &operator)
    }

    pub fn token_uri(env: Env, token_id: u64) -> Result<String, Error> {
        require_initialized(&env)?;
        get_token_metadata(&env, token_id).ok_or(Error::TokenNotFound)
    }

    // ── Enumeration ───────────────────────────────────────────────────────────

    /// Total number of tokens currently in existence.
    pub fn total_supply(env: Env) -> u64 {
        get_all_tokens(&env).len() as u64
    }

    /// Returns the token ID at position `index` in the global token list.
    pub fn token_by_index(env: Env, index: u64) -> Result<u64, Error> {
        let tokens = get_all_tokens(&env);
        let len = tokens.len() as u64;
        if index >= len {
            return Err(Error::IndexOutOfBounds);
        }
        Ok(tokens[index as usize])
    }

    /// Returns the number of tokens owned by `owner`.
    pub fn balance_of(env: Env, owner: Address) -> u64 {
        get_owner_tokens(&env, &owner).len() as u64
    }

    /// Returns the token ID at position `index` in `owner`'s token list.
    pub fn token_of_owner_by_index(env: Env, owner: Address, index: u64) -> Result<u64, Error> {
        let tokens = get_owner_tokens(&env, &owner);
        let len = tokens.len() as u64;
        if index >= len {
            return Err(Error::IndexOutOfBounds);
        }
        Ok(tokens[index as usize])
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn require_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if storage::get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
