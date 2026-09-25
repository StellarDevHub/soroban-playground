// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String, Vec};

use crate::types::{DataKey, Error};

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ── Mint counter ──────────────────────────────────────────────────────────────

pub fn get_token_mint_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MintCount)
        .unwrap_or(0u64)
}

pub fn set_token_mint_count(env: &Env, count: u64) {
    env.storage().instance().set(&DataKey::MintCount, &count);
}

// ── Ownership ─────────────────────────────────────────────────────────────────

pub fn get_owner(env: &Env, token_id: u64) -> Option<Address> {
    env.storage().persistent().get(&DataKey::Owner(token_id))
}

pub fn set_owner(env: &Env, token_id: u64, owner: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Owner(token_id), owner);
}

pub fn remove_owner(env: &Env, token_id: u64) {
    env.storage().persistent().remove(&DataKey::Owner(token_id));
}

// ── Approvals ─────────────────────────────────────────────────────────────────

pub fn get_approved(env: &Env, token_id: u64) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Approved(token_id))
}

pub fn set_approved(env: &Env, token_id: u64, spender: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::Approved(token_id), spender);
}

pub fn remove_approved(env: &Env, token_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Approved(token_id));
}

// ── Operator approvals ────────────────────────────────────────────────────────

pub fn get_operator_approval(env: &Env, owner: &Address, operator: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::OperatorApproval(owner.clone(), operator.clone()))
        .unwrap_or(false)
}

pub fn set_operator_approval(env: &Env, owner: &Address, operator: &Address, approved: bool) {
    if approved {
        env.storage().persistent().set(
            &DataKey::OperatorApproval(owner.clone(), operator.clone()),
            &true,
        );
    } else {
        env.storage()
            .persistent()
            .remove(&DataKey::OperatorApproval(owner.clone(), operator.clone()));
    }
}

// ── Token metadata ────────────────────────────────────────────────────────────

pub fn get_token_metadata(env: &Env, token_id: u64) -> Option<String> {
    env.storage()
        .persistent()
        .get(&DataKey::TokenMetadata(token_id))
}

pub fn set_token_metadata(env: &Env, token_id: u64, uri: &String) {
    env.storage()
        .persistent()
        .set(&DataKey::TokenMetadata(token_id), uri);
}

pub fn remove_token_metadata(env: &Env, token_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::TokenMetadata(token_id));
}

// ── Global enumeration list ───────────────────────────────────────────────────

pub fn get_all_tokens(env: &Env) -> Vec<u64> {
    env.storage()
        .instance()
        .get(&DataKey::AllTokens)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_to_all_tokens(env: &Env, token_id: u64) {
    let mut tokens = get_all_tokens(env);
    tokens.push_back(token_id);
    env.storage().instance().set(&DataKey::AllTokens, &tokens);
}

/// Remove `token_id` from the global list using swap-and-pop (O(1)).
///
/// The last element is moved into the removed element's position, which
/// changes the last element's index.  Callers that cache indices must
/// re-fetch the list after any burn.
pub fn remove_from_all_tokens(env: &Env, token_id: u64) {
    let mut tokens = get_all_tokens(env);
    let len = tokens.len();
    for i in 0..len {
        if tokens.get(i).unwrap() == token_id {
            // Swap with last element and pop.
            let last_index = len - 1;
            if i != last_index {
                let last = tokens.get(last_index).unwrap();
                tokens.set(i, last);
            }
            tokens.pop_back();
            break;
        }
    }
    env.storage().instance().set(&DataKey::AllTokens, &tokens);
}

// ── Per-owner enumeration list ────────────────────────────────────────────────

pub fn get_owner_tokens(env: &Env, owner: &Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::OwnerTokens(owner.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_to_owner_tokens(env: &Env, owner: &Address, token_id: u64) {
    let mut tokens = get_owner_tokens(env, owner);
    tokens.push_back(token_id);
    env.storage()
        .persistent()
        .set(&DataKey::OwnerTokens(owner.clone()), &tokens);
}

/// Remove `token_id` from `owner`'s list using swap-and-pop (O(1)).
pub fn remove_from_owner_tokens(env: &Env, owner: &Address, token_id: u64) {
    let mut tokens = get_owner_tokens(env, owner);
    let len = tokens.len();
    for i in 0..len {
        if tokens.get(i).unwrap() == token_id {
            let last_index = len - 1;
            if i != last_index {
                let last = tokens.get(last_index).unwrap();
                tokens.set(i, last);
            }
            tokens.pop_back();
            break;
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::OwnerTokens(owner.clone()), &tokens);
}
