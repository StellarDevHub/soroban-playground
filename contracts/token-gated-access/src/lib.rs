// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Token-Gated Access Control Contract
//!
//! Issues membership NFTs (Basic / Premium / Elite) that gate access to
//! community resources. Tracks analytics on-chain.
//!
//! ## Lifecycle
//! 1. Admin calls `initialize`.
//! 2. Admin mints membership NFTs via `mint`.
//! 3. Any caller checks access with `check_access` (requires minimum tier).
//! 4. Admin can `revoke` or `upgrade` memberships.
//! 5. Admin can `pause` / `unpause` the contract for emergencies.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Symbol};

use crate::storage::{
    get_access_count, get_admin, get_analytics, get_membership_by_token, get_token_id_for_owner,
    increment_access_count, is_initialized, is_paused, next_token_id, remove_membership,
    set_admin, set_analytics, set_membership, set_paused,
};
use crate::types::{Analytics, Error, Membership, Tier};

// ── Events ────────────────────────────────────────────────────────────────────

const EVT_MINT: Symbol = symbol_short!("mint");
const EVT_REVOKE: Symbol = symbol_short!("revoke");
const EVT_UPGRADE: Symbol = symbol_short!("upgrade");
const EVT_ACCESS: Symbol = symbol_short!("access");
const EVT_PAUSE: Symbol = symbol_short!("pause");

#[contract]
pub struct TokenGatedAccess;

#[contractimpl]
impl TokenGatedAccess {
    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Initialise the contract. Can only be called once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    /// Pause all state-changing operations (emergency circuit-breaker).
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((EVT_PAUSE,), (admin, true));
        Ok(())
    }

    /// Resume operations.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((EVT_PAUSE,), (admin, false));
        Ok(())
    }

    // ── NFT minting ───────────────────────────────────────────────────────────

    /// Mint a membership NFT to `recipient`. Admin only.
    /// `expires_at = 0` means the membership never expires.
    pub fn mint(
        env: Env,
        admin: Address,
        recipient: Address,
        tier: Tier,
        expires_at: u64,
        metadata_uri: String,
    ) -> Result<u64, Error> {
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;

        if get_token_id_for_owner(&env, &recipient).is_some() {
            return Err(Error::AlreadyMember);
        }
        if expires_at != 0 && expires_at <= env.ledger().timestamp() {
            return Err(Error::InvalidExpiry);
        }

        let token_id = next_token_id(&env);
        let membership = Membership {
            token_id,
            owner: recipient.clone(),
            tier,
            issued_at: env.ledger().timestamp(),
            expires_at,
            metadata_uri,
        };
        set_membership(&env, &membership);

        // Update analytics
        let mut stats = get_analytics(&env);
        stats.total_members += 1;
        match tier {
            Tier::Basic => stats.basic_count += 1,
            Tier::Premium => stats.premium_count += 1,
            Tier::Elite => stats.elite_count += 1,
        }
        stats.last_updated = env.ledger().timestamp();
        set_analytics(&env, &stats);

        env.events()
            .publish((EVT_MINT,), (token_id, recipient, tier as u32));
        Ok(token_id)
    }

    /// Revoke a membership NFT. Admin only.
    pub fn revoke(env: Env, admin: Address, token_id: u64) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;

        let m = get_membership_by_token(&env, token_id)?;
        remove_membership(&env, token_id, &m.owner);

        let mut stats = get_analytics(&env);
        if stats.total_members > 0 {
            stats.total_members -= 1;
        }
        match m.tier {
            Tier::Basic => { if stats.basic_count > 0 { stats.basic_count -= 1; } }
            Tier::Premium => { if stats.premium_count > 0 { stats.premium_count -= 1; } }
            Tier::Elite => { if stats.elite_count > 0 { stats.elite_count -= 1; } }
        }
        stats.last_updated = env.ledger().timestamp();
        set_analytics(&env, &stats);

        env.events().publish((EVT_REVOKE,), (token_id, m.owner));
        Ok(())
    }

    /// Upgrade a member's tier. Admin only.
    pub fn upgrade(env: Env, admin: Address, token_id: u64, new_tier: Tier) -> Result<(), Error> {
        Self::require_admin(&env, &admin)?;
        Self::require_not_paused(&env)?;

        let mut m = get_membership_by_token(&env, token_id)?;
        let old_tier = m.tier;
        m.tier = new_tier;
        set_membership(&env, &m);

        let mut stats = get_analytics(&env);
        // Decrement old tier count
        match old_tier {
            Tier::Basic => { if stats.basic_count > 0 { stats.basic_count -= 1; } }
            Tier::Premium => { if stats.premium_count > 0 { stats.premium_count -= 1; } }
            Tier::Elite => { if stats.elite_count > 0 { stats.elite_count -= 1; } }
        }
        // Increment new tier count
        match new_tier {
            Tier::Basic => stats.basic_count += 1,
            Tier::Premium => stats.premium_count += 1,
            Tier::Elite => stats.elite_count += 1,
        }
        stats.last_updated = env.ledger().timestamp();
        set_analytics(&env, &stats);

        env.events()
            .publish((EVT_UPGRADE,), (token_id, old_tier as u32, new_tier as u32));
        Ok(())
    }

    // ── Access control ────────────────────────────────────────────────────────

    /// Check whether `user` holds an active membership of at least `min_tier`.
    /// Records the access check in analytics. Returns `true` if access granted.
    pub fn check_access(env: Env, user: Address, min_tier: Tier) -> Result<bool, Error> {
        Self::require_not_paused(&env)?;

        let token_id = match get_token_id_for_owner(&env, &user) {
            Some(id) => id,
            None => {
                env.events().publish((EVT_ACCESS,), (user, false));
                return Ok(false);
            }
        };

        let m = get_membership_by_token(&env, token_id)?;

        // Check expiry
        if m.expires_at != 0 && m.expires_at < env.ledger().timestamp() {
            env.events().publish((EVT_ACCESS,), (user, false));
            return Ok(false);
        }

        // Check tier (Elite >= Premium >= Basic)
        let granted = (m.tier as u32) >= (min_tier as u32);

        increment_access_count(&env, &user);

        let mut stats = get_analytics(&env);
        stats.total_access_checks += 1;
        stats.last_updated = env.ledger().timestamp();
        set_analytics(&env, &stats);

        env.events().publish((EVT_ACCESS,), (user, granted));
        Ok(granted)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Get membership details by token ID.
    pub fn get_membership(env: Env, token_id: u64) -> Result<Membership, Error> {
        get_membership_by_token(&env, token_id)
    }

    /// Get the token ID owned by `user`, if any.
    pub fn get_token_id(env: Env, user: Address) -> Option<u64> {
        get_token_id_for_owner(&env, &user)
    }

    /// Get community analytics snapshot.
    pub fn get_analytics(env: Env) -> Analytics {
        get_analytics(&env)
    }

    /// Get how many times `user` has been access-checked.
    pub fn get_access_count(env: Env, user: Address) -> u64 {
        get_access_count(&env, &user)
    }

    /// Returns whether the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) {
            return Err(Error::Paused);
        }
        Ok(())
    }
}
