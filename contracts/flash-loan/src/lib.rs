// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Flash Loan Provider
//!
//! Provides uncollateralised flash loans within a single transaction.
//! A 0.5% fee is charged on each loan and added to the liquidity pool.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    add_fees, get_admin, get_balance, get_total_fees, get_total_loans, increment_loans,
    is_initialized, set_admin, set_balance, set_initialized,
};
use crate::types::{Error, FlashLoanStats};

/// Fee rate: 0.5% (5 / 1000).
const FEE_NUMERATOR: i128 = 5;
const FEE_DENOMINATOR: i128 = 1_000;

#[contract]
pub struct FlashLoanProvider;

#[contractimpl]
impl FlashLoanProvider {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin and seed liquidity.
    pub fn initialize(env: Env, admin: Address, initial_liquidity: i128) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if initial_liquidity < 0 {
            return Err(Error::InvalidAmount);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        set_balance(&env, initial_liquidity);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Liquidity management ──────────────────────────────────────────────────

    /// Deposit liquidity into the pool (admin only).
    pub fn deposit(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let balance = get_balance(&env);
        set_balance(&env, balance + amount);
        env.events().publish((symbol_short!("deposit"),), amount);
        Ok(())
    }

    /// Withdraw liquidity from the pool (admin only).
    pub fn withdraw(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let balance = get_balance(&env);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(&env, balance - amount);
        env.events().publish((symbol_short!("withdraw"),), amount);
        Ok(())
    }

    // ── Flash loan ────────────────────────────────────────────────────────────

    /// Execute a flash loan for `receiver`.
    ///
    /// The loan amount plus fee must be returned within the same transaction.
    /// In this playground implementation the repayment is simulated: the fee
    /// is added to the pool and the loan counter is incremented.
    pub fn flash_loan(env: Env, receiver: Address, amount: i128) -> Result<FlashLoanStats, Error> {
        Self::assert_initialized_guard(&env)?;
        receiver.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let balance = get_balance(&env);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let fee = (amount * FEE_NUMERATOR) / FEE_DENOMINATOR;

        // Disburse funds to receiver (simulated).
        set_balance(&env, balance - amount);

        // Receiver executes arbitrary logic here (simulated in playground).

        // Repayment: receiver returns amount + fee.
        // For the playground we enforce repayment by restoring balance + fee.
        set_balance(&env, balance + fee);

        increment_loans(&env);
        add_fees(&env, fee);

        env.events()
            .publish((symbol_short!("loan"), receiver), (amount, fee));

        Ok(FlashLoanStats {
            total_loans: get_total_loans(&env),
            total_fees_collected: get_total_fees(&env),
        })
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_stats(env: Env) -> FlashLoanStats {
        FlashLoanStats {
            total_loans: get_total_loans(&env),
            total_fees_collected: get_total_fees(&env),
        }
    }

    pub fn get_liquidity(env: Env) -> i128 {
        get_balance(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        Ok(get_admin(&env))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn assert_initialized_guard(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized_guard(env)?;
        caller.require_auth();
        if get_admin(env) != *caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
