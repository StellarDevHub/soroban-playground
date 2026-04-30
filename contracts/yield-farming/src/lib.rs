// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Yield Farming Aggregator
//!
//! A Soroban smart contract that aggregates yield strategies with:
//! - Auto-compounding: reinvests accrued rewards back into the principal.
//! - Strategy optimization: admin can update APY and pause/resume strategies.
//! - Portfolio tracking: per-user position tracking across multiple strategies.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_position, get_strategy, get_strategy_count, has_position, has_strategy,
    is_initialized, remove_position, set_admin, set_position, set_strategy, set_strategy_count,
};
use crate::types::{Error, Position, Strategy};

/// Seconds in a year — used for pro-rata reward accrual.
const SECONDS_PER_YEAR: u64 = 31_536_000;
/// Basis points denominator (10_000 bps = 100%).
const BPS_DENOM: u32 = 10_000;
/// Maximum allowed APY in basis points (10_000 = 100%).
const MAX_APY_BPS: u32 = 10_000;

#[contract]
pub struct YieldFarmingContract;

#[contractimpl]
impl YieldFarmingContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_strategy_count(&env, 0);
        Ok(())
    }

    // ── Strategy management (admin only) ──────────────────────────────────────

    /// Register a new yield strategy. Returns the new strategy ID.
    pub fn add_strategy(env: Env, admin: Address, name: String, apy_bps: u32) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }

        let id = get_strategy_count(&env) + 1;
        let strategy = Strategy {
            name,
            apy_bps,
            total_deposited: 0,
            is_active: true,
            pending_rewards: 0,
            last_compound_ts: env.ledger().timestamp(),
        };
        set_strategy(&env, id, &strategy);
        set_strategy_count(&env, id);

        env.events()
            .publish((symbol_short!("strat_add"), id), apy_bps);

        Ok(id)
    }

    /// Update the APY of an existing strategy.
    pub fn update_strategy_apy(
        env: Env,
        admin: Address,
        strategy_id: u32,
        new_apy_bps: u32,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if new_apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        let mut strategy = get_strategy(&env, strategy_id)?;
        strategy.apy_bps = new_apy_bps;
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("apy_upd"), strategy_id), new_apy_bps);

        Ok(())
    }

    /// Pause or resume a strategy.
    pub fn set_strategy_active(
        env: Env,
        admin: Address,
        strategy_id: u32,
        is_active: bool,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut strategy = get_strategy(&env, strategy_id)?;
        strategy.is_active = is_active;
        set_strategy(&env, strategy_id, &strategy);
        Ok(())
    }

    // ── User actions ──────────────────────────────────────────────────────────

    /// Deposit `amount` into a strategy.
    pub fn deposit(env: Env, user: Address, strategy_id: u32, amount: i128) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut strategy = get_strategy(&env, strategy_id)?;
        if !strategy.is_active {
            return Err(Error::StrategyPaused);
        }

        let now = env.ledger().timestamp();

        let mut position = if has_position(&env, strategy_id, &user) {
            // Auto-compound existing position before adding new funds
            let pos = get_position(&env, strategy_id, &user)?;
            Self::compound_position(pos, &strategy, now)
        } else {
            Position {
                deposited: 0,
                compounded_balance: 0,
                last_update_ts: now,
            }
        };

        position.deposited += amount;
        position.compounded_balance += amount;
        position.last_update_ts = now;

        strategy.total_deposited += amount;

        set_position(&env, strategy_id, &user, &position);
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("deposit"), strategy_id), (user, amount));

        Ok(())
    }

    /// Withdraw `amount` from a strategy (withdraws from compounded balance).
    pub fn withdraw(env: Env, user: Address, strategy_id: u32, amount: i128) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut strategy = get_strategy(&env, strategy_id)?;
        let now = env.ledger().timestamp();

        let mut position = get_position(&env, strategy_id, &user)?;
        // Compound before withdrawal so user gets latest rewards
        position = Self::compound_position(position, &strategy, now);

        if amount > position.compounded_balance {
            return Err(Error::InsufficientBalance);
        }

        position.compounded_balance -= amount;
        // Reduce deposited proportionally (can't go below 0)
        let deposited_reduction = amount.min(position.deposited);
        position.deposited -= deposited_reduction;
        position.last_update_ts = now;

        let tvl_reduction = amount.min(strategy.total_deposited);
        strategy.total_deposited -= tvl_reduction;

        if position.compounded_balance == 0 {
            remove_position(&env, strategy_id, &user);
        } else {
            set_position(&env, strategy_id, &user, &position);
        }
        set_strategy(&env, strategy_id, &strategy);

        env.events()
            .publish((symbol_short!("withdraw"), strategy_id), (user, amount));

        Ok(amount)
    }

    /// Trigger auto-compounding for a user's position in a strategy.
    /// Anyone can call this (e.g. a keeper bot), but only the user's position is updated.
    pub fn compound(env: Env, user: Address, strategy_id: u32) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;

        let strategy = get_strategy(&env, strategy_id)?;
        let now = env.ledger().timestamp();

        let position = get_position(&env, strategy_id, &user)?;
        let compounded = Self::compound_position(position, &strategy, now);
        let new_balance = compounded.compounded_balance;

        set_position(&env, strategy_id, &user, &compounded);

        env.events()
            .publish((symbol_short!("compound"), strategy_id), (user, new_balance));

        Ok(new_balance)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Return strategy details by ID.
    pub fn get_strategy(env: Env, strategy_id: u32) -> Result<Strategy, Error> {
        get_strategy(&env, strategy_id)
    }

    /// Return the total number of registered strategies.
    pub fn strategy_count(env: Env) -> u32 {
        get_strategy_count(&env)
    }

    /// Return a user's position in a strategy (with up-to-date compounded balance).
    pub fn get_position(env: Env, user: Address, strategy_id: u32) -> Result<Position, Error> {
        let strategy = get_strategy(&env, strategy_id)?;
        let position = get_position(&env, strategy_id, &user)?;
        let now = env.ledger().timestamp();
        Ok(Self::compound_position(position, &strategy, now))
    }

    /// Return the admin address.
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Return whether the contract is initialized.
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Return all strategy IDs that exist (up to strategy_count).
    pub fn list_strategies(env: Env) -> Vec<u32> {
        let count = get_strategy_count(&env);
        let mut ids = Vec::new(&env);
        for i in 1..=count {
            if has_strategy(&env, i) {
                ids.push_back(i);
            }
        }
        ids
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Compute accrued rewards and return an updated Position (pure, no storage writes).
    fn compound_position(mut position: Position, strategy: &Strategy, now: u64) -> Position {
        let elapsed = now.saturating_sub(position.last_update_ts);
        if elapsed == 0 || strategy.apy_bps == 0 || position.compounded_balance == 0 {
            return position;
        }

        // reward = balance * apy_bps / BPS_DENOM * elapsed / SECONDS_PER_YEAR
        // Use i128 arithmetic to avoid overflow on large balances.
        let reward = (position.compounded_balance as i128)
            .saturating_mul(strategy.apy_bps as i128)
            .saturating_mul(elapsed as i128)
            / (BPS_DENOM as i128 * SECONDS_PER_YEAR as i128);

        position.compounded_balance = position.compounded_balance.saturating_add(reward);
        position.last_update_ts = now;
        position
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
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
