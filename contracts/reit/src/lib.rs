// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Tokenized REIT with Dividend Distribution
//!
//! Distinct from the real-estate contract by providing:
//! - Share minting/burning (token lifecycle) per property.
//! - Dividend distribution (not just rental) with pull-over-push pattern.
//! - Share transfers with automatic dividend settlement.
//! - Portfolio-level view (total properties, total shares issued).
//! - Emergency pause/unpause.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_holding, get_property, get_property_count, is_initialized, is_paused,
    remove_holding, set_admin, set_holding, set_paused, set_property, set_property_count,
};
use crate::types::{Error, Holding, Property};

#[contract]
pub struct ReitContract;

#[contractimpl]
impl ReitContract {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_property_count(&env, 0);
        env.events().publish((symbol_short!("init"),), (admin,));
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    // ── Property registry ─────────────────────────────────────────────────────

    /// Register a new property in the REIT portfolio. Returns property ID.
    pub fn add_property(
        env: Env,
        admin: Address,
        name: String,
        total_shares: u64,
        price_per_share: i128,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if total_shares == 0 {
            return Err(Error::ZeroTotalShares);
        }
        if price_per_share <= 0 {
            return Err(Error::ZeroPrice);
        }
        let id = get_property_count(&env) + 1;
        set_property(
            &env,
            id,
            &Property {
                name: name.clone(),
                total_shares,
                shares_issued: 0,
                price_per_share,
                total_dividends: 0,
                is_active: true,
            },
        );
        set_property_count(&env, id);
        env.events()
            .publish((symbol_short!("prop_add"), id), (name, total_shares));
        Ok(id)
    }

    /// Deactivate a property (no new mints accepted).
    pub fn deactivate_property(env: Env, admin: Address, property_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut p = get_property(&env, property_id)?;
        p.is_active = false;
        set_property(&env, property_id, &p);
        env.events()
            .publish((symbol_short!("prop_off"), property_id), ());
        Ok(())
    }

    // ── Share minting / burning ───────────────────────────────────────────────

    /// Mint `shares` for `investor` in a property. Returns total cost.
    pub fn mint_shares(
        env: Env,
        investor: Address,
        property_id: u32,
        shares: u64,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        investor.require_auth();
        if shares == 0 {
            return Err(Error::ZeroShares);
        }
        let mut p = get_property(&env, property_id)?;
        if !p.is_active {
            return Err(Error::PropertyInactive);
        }
        if p.shares_issued + shares > p.total_shares {
            return Err(Error::ExceedsTotalSupply);
        }
        let cost = (shares as i128).saturating_mul(p.price_per_share);
        let mut h = get_holding(&env, property_id, &investor).unwrap_or(Holding {
            shares: 0,
            dividends_claimed_snapshot: p.total_dividends,
        });
        // Settle any pending dividends before changing share count
        let pending = Self::compute_pending(&h, &p);
        h.dividends_claimed_snapshot += pending;
        h.shares += shares;
        p.shares_issued += shares;
        set_holding(&env, property_id, &investor, &h);
        set_property(&env, property_id, &p);
        env.events()
            .publish((symbol_short!("mint"), property_id), (investor, shares));
        Ok(cost)
    }

    /// Burn `shares` from `investor`. Returns shares burned.
    pub fn burn_shares(
        env: Env,
        investor: Address,
        property_id: u32,
        shares: u64,
    ) -> Result<u64, Error> {
        Self::assert_not_paused(&env)?;
        investor.require_auth();
        if shares == 0 {
            return Err(Error::ZeroShares);
        }
        let mut p = get_property(&env, property_id)?;
        let mut h = get_holding(&env, property_id, &investor)
            .ok_or(Error::InsufficientShares)?;
        if shares > h.shares {
            return Err(Error::InsufficientShares);
        }
        // Settle dividends before burn
        let pending = Self::compute_pending(&h, &p);
        h.dividends_claimed_snapshot += pending;
        h.shares -= shares;
        p.shares_issued -= shares;
        if h.shares == 0 {
            remove_holding(&env, property_id, &investor);
        } else {
            set_holding(&env, property_id, &investor, &h);
        }
        set_property(&env, property_id, &p);
        env.events()
            .publish((symbol_short!("burn"), property_id), (investor, shares));
        Ok(shares)
    }

    /// Transfer shares from `from` to `to` with automatic dividend settlement.
    pub fn transfer_shares(
        env: Env,
        from: Address,
        to: Address,
        property_id: u32,
        shares: u64,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        if from == to {
            return Err(Error::InvalidRecipient);
        }
        from.require_auth();
        if shares == 0 {
            return Err(Error::ZeroShares);
        }
        let p = get_property(&env, property_id)?;
        let mut from_h = get_holding(&env, property_id, &from)
            .ok_or(Error::InsufficientShares)?;
        if shares > from_h.shares {
            return Err(Error::InsufficientShares);
        }
        // Settle sender dividends
        let pending = Self::compute_pending(&from_h, &p);
        from_h.dividends_claimed_snapshot += pending;
        from_h.shares -= shares;

        let mut to_h = get_holding(&env, property_id, &to).unwrap_or(Holding {
            shares: 0,
            dividends_claimed_snapshot: p.total_dividends,
        });
        to_h.shares += shares;

        if from_h.shares == 0 {
            remove_holding(&env, property_id, &from);
        } else {
            set_holding(&env, property_id, &from, &from_h);
        }
        set_holding(&env, property_id, &to, &to_h);
        env.events()
            .publish((symbol_short!("xfer"), property_id), (from, to, shares));
        Ok(())
    }

    // ── Dividend distribution ─────────────────────────────────────────────────

    /// Deposit dividends for a property (admin only). Pull-over-push: investors claim separately.
    pub fn deposit_dividends(
        env: Env,
        admin: Address,
        property_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::ZeroDividend);
        }
        let mut p = get_property(&env, property_id)?;
        p.total_dividends += amount;
        set_property(&env, property_id, &p);
        env.events()
            .publish((symbol_short!("div_dep"), property_id), amount);
        Ok(())
    }

    /// Claim accrued dividends for `investor`. Returns amount claimed.
    pub fn claim_dividends(
        env: Env,
        investor: Address,
        property_id: u32,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        investor.require_auth();
        let p = get_property(&env, property_id)?;
        let mut h = get_holding(&env, property_id, &investor)
            .ok_or(Error::InsufficientShares)?;
        let claimable = Self::compute_pending(&h, &p);
        if claimable == 0 {
            return Err(Error::NothingToClaim);
        }
        h.dividends_claimed_snapshot += claimable;
        set_holding(&env, property_id, &investor, &h);
        env.events()
            .publish((symbol_short!("div_clm"), property_id), (investor, claimable));
        Ok(claimable)
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_property(env: Env, property_id: u32) -> Result<Property, Error> {
        get_property(&env, property_id)
    }

    pub fn property_count(env: Env) -> u32 {
        get_property_count(&env)
    }

    pub fn get_holding(env: Env, investor: Address, property_id: u32) -> Option<Holding> {
        get_holding(&env, property_id, &investor)
    }

    /// Return pending claimable dividends without mutating state.
    pub fn pending_dividends(env: Env, investor: Address, property_id: u32) -> Result<i128, Error> {
        let p = get_property(&env, property_id)?;
        let h = get_holding(&env, property_id, &investor)
            .ok_or(Error::InsufficientShares)?;
        Ok(Self::compute_pending(&h, &p))
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// pending = (total_dividends - snapshot) * shares / shares_issued
    fn compute_pending(h: &Holding, p: &Property) -> i128 {
        if p.shares_issued == 0 || h.shares == 0 {
            return 0;
        }
        let new_divs = p.total_dividends.saturating_sub(h.dividends_claimed_snapshot);
        if new_divs <= 0 {
            return 0;
        }
        new_divs
            .saturating_mul(h.shares as i128)
            / (p.shares_issued as i128)
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        caller.require_auth();
        if *caller != get_admin(env)? {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }
}
