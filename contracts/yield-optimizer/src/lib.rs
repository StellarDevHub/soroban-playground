// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Cross-Protocol Yield Optimizer with Auto-Compounding
//!
//! - Protocol registry: admin registers external yield protocols with base APY.
//! - Vaults: each vault routes deposits to one protocol; admin can rebalance.
//! - Deposits / withdrawals: users deposit into vaults and withdraw at any time.
//! - Auto-compounding: anyone can trigger compound on a vault; rewards are
//!   reinvested pro-rata into all depositors' compounded balances.
//! - Backtesting snapshots: admin records APY/TVL snapshots for strategy analysis.
//! - Emergency pause: halts all user-facing mutations.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_backtest, get_backtest_count, get_position, get_protocol, get_protocol_count,
    get_vault, get_vault_count, has_position, has_protocol, has_vault, is_initialized, is_paused,
    remove_position, set_admin, set_backtest, set_backtest_count, set_paused, set_position,
    set_protocol, set_protocol_count, set_vault, set_vault_count,
};
use crate::types::{BacktestEntry, Error, Position, Protocol, Vault};

const SECONDS_PER_YEAR: u64 = 31_536_000;
const BPS_DENOM: u32 = 10_000;
const MAX_APY_BPS: u32 = 50_000; // 500% max

#[contract]
pub struct YieldOptimizerContract;

#[contractimpl]
impl YieldOptimizerContract {
    // ── Init ──────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_protocol_count(&env, 0);
        set_vault_count(&env, 0);
        set_backtest_count(&env, 0);
        set_paused(&env, false);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Admin: protocols ──────────────────────────────────────────────────────

    /// Register a new external yield protocol. Returns protocol ID.
    pub fn add_protocol(
        env: Env,
        admin: Address,
        name: String,
        base_apy_bps: u32,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if base_apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        let id = get_protocol_count(&env) + 1;
        set_protocol(&env, id, &Protocol { name, base_apy_bps, is_active: true });
        set_protocol_count(&env, id);
        env.events().publish((symbol_short!("proto_add"), id), base_apy_bps);
        Ok(id)
    }

    /// Update a protocol's APY (e.g. after on-chain oracle update).
    pub fn update_protocol_apy(
        env: Env,
        admin: Address,
        protocol_id: u32,
        new_apy_bps: u32,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if new_apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        let mut p = get_protocol(&env, protocol_id)?;
        p.base_apy_bps = new_apy_bps;
        set_protocol(&env, protocol_id, &p);
        env.events().publish((symbol_short!("proto_apy"), protocol_id), new_apy_bps);
        Ok(())
    }

    // ── Admin: vaults ─────────────────────────────────────────────────────────

    /// Create a new optimizer vault backed by a protocol. Returns vault ID.
    pub fn create_vault(
        env: Env,
        admin: Address,
        name: String,
        protocol_id: u32,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        let protocol = get_protocol(&env, protocol_id)?;
        let id = get_vault_count(&env) + 1;
        set_vault(&env, id, &Vault {
            name,
            protocol_id,
            current_apy_bps: protocol.base_apy_bps,
            total_deposited: 0,
            pending_rewards: 0,
            last_compound_ts: env.ledger().timestamp(),
            total_compounded: 0,
            is_active: true,
        });
        set_vault_count(&env, id);
        env.events().publish((symbol_short!("vault_new"), id), protocol_id);
        Ok(id)
    }

    /// Rebalance a vault to a different protocol (optimizes for best APY).
    pub fn rebalance_vault(
        env: Env,
        admin: Address,
        vault_id: u32,
        new_protocol_id: u32,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let protocol = get_protocol(&env, new_protocol_id)?;
        if !protocol.is_active {
            return Err(Error::VaultInactive);
        }
        let mut vault = get_vault(&env, vault_id)?;
        vault.protocol_id = new_protocol_id;
        vault.current_apy_bps = protocol.base_apy_bps;
        set_vault(&env, vault_id, &vault);
        env.events().publish((symbol_short!("rebalance"), vault_id), new_protocol_id);
        Ok(())
    }

    /// Deactivate a vault (no new deposits).
    pub fn deactivate_vault(env: Env, admin: Address, vault_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut vault = get_vault(&env, vault_id)?;
        vault.is_active = false;
        set_vault(&env, vault_id, &vault);
        Ok(())
    }

    // ── Admin: backtesting ────────────────────────────────────────────────────

    /// Record a backtesting snapshot for a vault (APY + TVL at current timestamp).
    pub fn record_backtest(env: Env, admin: Address, vault_id: u32) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        let vault = get_vault(&env, vault_id)?;
        let id = get_backtest_count(&env) + 1;
        set_backtest(&env, id, &BacktestEntry {
            vault_id,
            apy_bps: vault.current_apy_bps,
            tvl: vault.total_deposited,
            timestamp: env.ledger().timestamp(),
        });
        set_backtest_count(&env, id);
        env.events().publish((symbol_short!("backtest"), id), vault_id);
        Ok(id)
    }

    // ── Admin: pause ──────────────────────────────────────────────────────────

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

    // ── User: deposit ─────────────────────────────────────────────────────────

    /// Deposit into a vault. Returns updated compounded balance.
    pub fn deposit(env: Env, user: Address, vault_id: u32, amount: i128) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut vault = get_vault(&env, vault_id)?;
        if !vault.is_active {
            return Err(Error::VaultInactive);
        }

        let mut pos = if has_position(&env, vault_id, &user) {
            // Accrue pending rewards before adding new deposit
            let accrued = Self::accrue_rewards(&pos_or_default(&env, vault_id, &user), &vault, env.ledger().timestamp());
            let mut p = get_position(&env, vault_id, &user)?;
            p.compounded_balance += accrued;
            p.last_update_ts = env.ledger().timestamp();
            p
        } else {
            Position { deposited: 0, compounded_balance: 0, last_update_ts: env.ledger().timestamp() }
        };

        pos.deposited += amount;
        pos.compounded_balance += amount;
        vault.total_deposited += amount;
        set_position(&env, vault_id, &user, &pos);
        set_vault(&env, vault_id, &vault);

        env.events().publish((symbol_short!("deposit"), vault_id), (user, amount));
        Ok(pos.compounded_balance)
    }

    /// Withdraw from a vault. Returns amount withdrawn.
    pub fn withdraw(env: Env, user: Address, vault_id: u32, amount: i128) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut vault = get_vault(&env, vault_id)?;
        let mut pos = get_position(&env, vault_id, &user)?;

        // Accrue before withdraw
        let accrued = Self::accrue_rewards(&pos, &vault, env.ledger().timestamp());
        pos.compounded_balance += accrued;
        pos.last_update_ts = env.ledger().timestamp();

        if amount > pos.compounded_balance {
            return Err(Error::InsufficientBalance);
        }

        pos.compounded_balance -= amount;
        // Reduce deposited proportionally (can't go below 0)
        pos.deposited = pos.deposited.saturating_sub(amount);
        vault.total_deposited = vault.total_deposited.saturating_sub(amount);

        if pos.compounded_balance == 0 {
            remove_position(&env, vault_id, &user);
        } else {
            set_position(&env, vault_id, &user, &pos);
        }
        set_vault(&env, vault_id, &vault);

        env.events().publish((symbol_short!("withdraw"), vault_id), (user, amount));
        Ok(amount)
    }

    // ── Auto-compound ─────────────────────────────────────────────────────────

    /// Compound pending rewards for a vault. Anyone can call this.
    /// Rewards are calculated based on elapsed time × APY × TVL.
    /// Returns total rewards compounded.
    pub fn compound(env: Env, vault_id: u32) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        let mut vault = get_vault(&env, vault_id)?;
        if !vault.is_active {
            return Err(Error::VaultInactive);
        }

        let now = env.ledger().timestamp();
        let elapsed = now.saturating_sub(vault.last_compound_ts);
        if elapsed == 0 || vault.total_deposited == 0 {
            return Ok(0);
        }

        // rewards = TVL × APY_bps / BPS_DENOM × elapsed / SECONDS_PER_YEAR
        let rewards = vault
            .total_deposited
            .saturating_mul(vault.current_apy_bps as i128)
            / (BPS_DENOM as i128)
            * (elapsed as i128)
            / (SECONDS_PER_YEAR as i128);

        if rewards <= 0 {
            return Ok(0);
        }

        vault.pending_rewards += rewards;
        vault.total_deposited += rewards; // reinvest into TVL
        vault.total_compounded += rewards;
        vault.last_compound_ts = now;
        set_vault(&env, vault_id, &vault);

        env.events().publish((symbol_short!("compound"), vault_id), rewards);
        Ok(rewards)
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_vault(env: Env, vault_id: u32) -> Result<Vault, Error> {
        get_vault(&env, vault_id)
    }

    pub fn get_protocol(env: Env, protocol_id: u32) -> Result<Protocol, Error> {
        get_protocol(&env, protocol_id)
    }

    pub fn get_position(env: Env, user: Address, vault_id: u32) -> Result<Position, Error> {
        get_position(&env, vault_id, &user)
    }

    pub fn get_backtest(env: Env, backtest_id: u32) -> Result<BacktestEntry, Error> {
        get_backtest(&env, backtest_id)
    }

    /// Estimate current compounded balance for a user (read-only).
    pub fn estimated_balance(env: Env, user: Address, vault_id: u32) -> Result<i128, Error> {
        let vault = get_vault(&env, vault_id)?;
        let pos = get_position(&env, vault_id, &user)?;
        let accrued = Self::accrue_rewards(&pos, &vault, env.ledger().timestamp());
        Ok(pos.compounded_balance + accrued)
    }

    pub fn vault_count(env: Env) -> u32 { get_vault_count(&env) }
    pub fn protocol_count(env: Env) -> u32 { get_protocol_count(&env) }
    pub fn backtest_count(env: Env) -> u32 { get_backtest_count(&env) }
    pub fn is_initialized(env: Env) -> bool { is_initialized(&env) }
    pub fn is_paused(env: Env) -> bool { is_paused(&env) }
    pub fn get_admin(env: Env) -> Result<Address, Error> { get_admin(&env) }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// Pro-rata reward accrual for a single position since last_update_ts.
    fn accrue_rewards(pos: &Position, vault: &Vault, now: u64) -> i128 {
        if vault.total_deposited == 0 || pos.compounded_balance == 0 {
            return 0;
        }
        let elapsed = now.saturating_sub(pos.last_update_ts);
        if elapsed == 0 {
            return 0;
        }
        pos.compounded_balance
            .saturating_mul(vault.current_apy_bps as i128)
            / (BPS_DENOM as i128)
            * (elapsed as i128)
            / (SECONDS_PER_YEAR as i128)
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) { return Err(Error::NotInitialized); }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) { return Err(Error::ContractPaused); }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        if *caller != get_admin(env)? { return Err(Error::Unauthorized); }
        Ok(())
    }
}

/// Helper: get position or return a zero default (used in deposit accrual).
fn pos_or_default(env: &Env, vault_id: u32, user: &Address) -> Position {
    get_position(env, vault_id, user).unwrap_or(Position {
        deposited: 0,
        compounded_balance: 0,
        last_update_ts: env.ledger().timestamp(),
    })
}
