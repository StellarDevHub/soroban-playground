// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Tokenized REIT with Dividend Distribution
//!
//! A Soroban smart contract providing:
//! - REIT creation: admin tokenizes real estate trusts into fractional shares.
//! - Investment: investors buy shares at a fixed price per share.
//! - Dividend distribution: admin deposits dividends; investors claim pro-rata.
//! - Share transfers: investors can transfer shares to other addresses.
//! - Emergency pause: admin can pause/unpause all investor operations.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_holding, get_trust, get_trust_count, has_holding, is_initialized, is_paused,
    remove_holding, set_admin, set_holding, set_paused, set_trust, set_trust_count,
};
use crate::types::{Error, Holding, InstanceKey, ReitTrust};

#[contract]
pub struct TokenizedReitContract;

#[contractimpl]
impl TokenizedReitContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_trust_count(&env, 0);
        set_paused(&env, false);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Admin: REIT management ────────────────────────────────────────────────

    /// Create a new REIT trust. Returns the trust ID.
    pub fn create_trust(
        env: Env,
        admin: Address,
        name: String,
        total_shares: u64,
        price_per_share: i128,
        annual_yield_bps: u32,
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

        let id = get_trust_count(&env) + 1;
        let trust = ReitTrust {
            name,
            total_shares,
            shares_sold: 0,
            price_per_share,
            total_dividends_deposited: 0,
            annual_yield_bps,
            is_active: true,
        };
        set_trust(&env, id, &trust);
        set_trust_count(&env, id);

        env.events()
            .publish((symbol_short!("trust_new"), id), total_shares);

        Ok(id)
    }

    /// Deactivate a trust (no new investments accepted).
    pub fn deactivate_trust(env: Env, admin: Address, trust_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut trust = get_trust(&env, trust_id)?;
        trust.is_active = false;
        set_trust(&env, trust_id, &trust);
        env.events()
            .publish((symbol_short!("trust_off"), trust_id), ());
        Ok(())
    }

    /// Deposit dividend income for a trust. Distributed pro-rata to shareholders.
    pub fn deposit_dividends(
        env: Env,
        admin: Address,
        trust_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::ZeroDividend);
        }
        let mut trust = get_trust(&env, trust_id)?;
        trust.total_dividends_deposited += amount;
        set_trust(&env, trust_id, &trust);

        env.events()
            .publish((symbol_short!("dividend"), trust_id), amount);

        Ok(())
    }

    /// Emergency pause — halts all investor operations.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    /// Resume operations after a pause.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    // ── Investor actions ──────────────────────────────────────────────────────

    /// Buy `shares` in an active trust. Returns total cost in stroops.
    pub fn buy_shares(
        env: Env,
        investor: Address,
        trust_id: u32,
        shares: u64,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        investor.require_auth();

        if shares == 0 {
            return Err(Error::ZeroShares);
        }

        let mut trust = get_trust(&env, trust_id)?;
        if !trust.is_active {
            return Err(Error::NotActive);
        }
        if trust.shares_sold + shares > trust.total_shares {
            return Err(Error::ExceedsTotalSupply);
        }

        let cost = (shares as i128).saturating_mul(trust.price_per_share);

        // Snapshot dividends_claimed so new investor doesn't retroactively
        // claim dividends deposited before their purchase.
        let mut holding = if has_holding(&env, trust_id, &investor) {
            get_holding(&env, trust_id, &investor)?
        } else {
            Holding {
                shares: 0,
                dividends_claimed: trust.total_dividends_deposited,
            }
        };

        holding.shares += shares;
        trust.shares_sold += shares;

        set_holding(&env, trust_id, &investor, &holding);
        set_trust(&env, trust_id, &trust);

        env.events()
            .publish((symbol_short!("buy"), trust_id), (investor, shares, cost));

        Ok(cost)
    }

    /// Transfer `shares` from caller to `recipient`.
    pub fn transfer_shares(
        env: Env,
        from: Address,
        to: Address,
        trust_id: u32,
        shares: u64,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        from.require_auth();

        if shares == 0 {
            return Err(Error::ZeroShares);
        }

        let trust = get_trust(&env, trust_id)?;
        let mut from_holding = get_holding(&env, trust_id, &from)?;

        if shares > from_holding.shares {
            return Err(Error::InsufficientShares);
        }

        // Settle unclaimed dividends for sender before transfer
        let claimable = Self::compute_claimable(&from_holding, &trust);
        from_holding.dividends_claimed += claimable;
        from_holding.shares -= shares;

        let mut to_holding = if has_holding(&env, trust_id, &to) {
            get_holding(&env, trust_id, &to)?
        } else {
            Holding {
                shares: 0,
                dividends_claimed: trust.total_dividends_deposited,
            }
        };
        to_holding.shares += shares;

        if from_holding.shares == 0 {
            remove_holding(&env, trust_id, &from);
        } else {
            set_holding(&env, trust_id, &from, &from_holding);
        }
        set_holding(&env, trust_id, &to, &to_holding);

        env.events()
            .publish((symbol_short!("transfer"), trust_id), (from, to, shares));

        Ok(())
    }

    /// Claim pro-rata dividend income. Returns amount claimed in stroops.
    pub fn claim_dividends(
        env: Env,
        investor: Address,
        trust_id: u32,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        investor.require_auth();

        let trust = get_trust(&env, trust_id)?;
        let mut holding = get_holding(&env, trust_id, &investor)?;

        let claimable = Self::compute_claimable(&holding, &trust);
        if claimable == 0 {
            return Err(Error::NothingToClaim);
        }

        holding.dividends_claimed += claimable;
        set_holding(&env, trust_id, &investor, &holding);

        env.events()
            .publish((symbol_short!("claim"), trust_id), (investor, claimable));

        Ok(claimable)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_trust(env: Env, trust_id: u32) -> Result<ReitTrust, Error> {
        get_trust(&env, trust_id)
    }

    pub fn get_holding(env: Env, investor: Address, trust_id: u32) -> Result<Holding, Error> {
        get_holding(&env, trust_id, &investor)
    }

    /// Return claimable dividends for an investor without mutating state.
    pub fn claimable_dividends(
        env: Env,
        investor: Address,
        trust_id: u32,
    ) -> Result<i128, Error> {
        let trust = get_trust(&env, trust_id)?;
        let holding = get_holding(&env, trust_id, &investor)?;
        Ok(Self::compute_claimable(&holding, &trust))
    }

    pub fn trust_count(env: Env) -> u32 {
        get_trust_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Pro-rata claimable = (shares / total_shares) * (total_deposited - claimed_snapshot)
    fn compute_claimable(holding: &Holding, trust: &ReitTrust) -> i128 {
        if trust.shares_sold == 0 || holding.shares == 0 {
            return 0;
        }
        let new_dividends = trust
            .total_dividends_deposited
            .saturating_sub(holding.dividends_claimed);
        if new_dividends <= 0 {
            return 0;
        }
        new_dividends
            .saturating_mul(holding.shares as i128)
            / (trust.total_shares as i128)
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
