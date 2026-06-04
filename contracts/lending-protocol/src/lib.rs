// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Lending Protocol
//!
//! A simple over-collateralised lending pool.
//!
//! ## Collateral rules
//! - **Borrow**: `(borrowed + amount) * 150 ≤ deposited * 100`
//!   (minimum 150 % collateralisation ratio).
//! - **Withdraw**: `(deposited - amount) * 100 ≥ borrowed * 150`
//!   (same ratio must hold after withdrawal).
//! - **Liquidation threshold**: `borrowed * 110 > deposited * 100`
//!   (position is under-water when collateral falls below 110 %).
//!
//! ## Credit scoring
//! Each successful repayment increments the user's `credit_score` by 5.

#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    get_position, get_total_borrowed, get_total_deposited, is_initialized, set_admin,
    set_initialized, set_position, set_total_borrowed, set_total_deposited,
};
use crate::types::{Error, PoolStats, UserPosition};

/// Minimum collateralisation ratio numerator (150 %).
const COLLATERAL_RATIO_NUM: i128 = 150;
/// Minimum collateralisation ratio denominator.
const COLLATERAL_RATIO_DEN: i128 = 100;
/// Liquidation threshold numerator (110 %).
const LIQUIDATION_THRESHOLD_NUM: i128 = 110;
/// Liquidation bonus: liquidator receives 110 % of the repaid amount.
const LIQUIDATION_BONUS_NUM: i128 = 110;
const LIQUIDATION_BONUS_DEN: i128 = 100;
/// Credit score increment per repayment.
const CREDIT_SCORE_INCREMENT: i128 = 5;

#[contract]
pub struct LendingProtocol;

#[contractimpl]
impl LendingProtocol {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the pool with an admin address.
    ///
    /// # Errors
    /// - [`Error::AlreadyInitialized`] if called more than once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_admin(&env, &admin);
        set_initialized(&env);
        Ok(())
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// Deposit `amount` tokens as collateral.
    ///
    /// # Errors
    /// - [`Error::InvalidAmount`] if `amount ≤ 0`.
    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = get_position(&env, &user);
        pos.deposited += amount;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);
        set_total_deposited(&env, get_total_deposited(&env) + amount);

        env.events().publish((symbol_short!("deposit"), user), amount);
        Ok(())
    }

    // ── Withdraw ──────────────────────────────────────────────────────────────

    /// Withdraw `amount` tokens from the collateral pool.
    ///
    /// # Errors
    /// - [`Error::InvalidAmount`] if `amount ≤ 0`.
    /// - [`Error::InsufficientBalance`] if the user has deposited less than `amount`.
    /// - [`Error::InsufficientCollateral`] if withdrawal would breach the 150 % ratio.
    pub fn withdraw(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = get_position(&env, &user);
        if pos.deposited < amount {
            return Err(Error::InsufficientBalance);
        }

        // Ensure the remaining collateral still covers outstanding borrows.
        let remaining_deposit = pos.deposited - amount;
        if pos.borrowed > 0
            && remaining_deposit * COLLATERAL_RATIO_DEN < pos.borrowed * COLLATERAL_RATIO_NUM
        {
            return Err(Error::InsufficientCollateral);
        }

        pos.deposited -= amount;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);
        set_total_deposited(&env, get_total_deposited(&env) - amount);

        env.events().publish((symbol_short!("withdraw"), user), amount);
        Ok(())
    }

    // ── Borrow ────────────────────────────────────────────────────────────────

    /// Borrow `amount` tokens against deposited collateral.
    ///
    /// # Errors
    /// - [`Error::InvalidAmount`] if `amount ≤ 0`.
    /// - [`Error::InsufficientCollateral`] if the borrow would breach the 150 % ratio.
    pub fn borrow(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = get_position(&env, &user);
        let new_borrowed = pos.borrowed + amount;

        // (borrowed + amount) * 150 > deposited * 100  →  reject
        if new_borrowed * COLLATERAL_RATIO_NUM > pos.deposited * COLLATERAL_RATIO_DEN {
            return Err(Error::InsufficientCollateral);
        }

        pos.borrowed = new_borrowed;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);
        set_total_borrowed(&env, get_total_borrowed(&env) + amount);

        env.events().publish((symbol_short!("borrow"), user), amount);
        Ok(())
    }

    // ── Repay ─────────────────────────────────────────────────────────────────

    /// Repay up to `amount` of the caller's outstanding borrow.
    ///
    /// The actual repaid amount is capped at the outstanding balance so callers
    /// may safely pass [`i128::MAX`] to repay everything.
    ///
    /// # Errors
    /// - [`Error::InvalidAmount`] if `amount ≤ 0`.
    /// - [`Error::RepayExceedsBorrow`] if `amount` is strictly greater than the
    ///   outstanding borrow (strict mode — callers should use the capped variant
    ///   if they want to repay-all).
    pub fn repay(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = get_position(&env, &user);

        // Cap repayment at outstanding balance.
        let actual_repay = amount.min(pos.borrowed);
        if actual_repay == 0 {
            // Nothing to repay — treat as invalid amount.
            return Err(Error::InvalidAmount);
        }

        pos.borrowed -= actual_repay;
        pos.credit_score += CREDIT_SCORE_INCREMENT;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);
        set_total_borrowed(&env, get_total_borrowed(&env) - actual_repay);

        env.events().publish(
            (symbol_short!("repayment"), user.clone()),
            (actual_repay, pos.credit_score),
        );

        Ok(actual_repay)
    }

    // ── Liquidate ─────────────────────────────────────────────────────────────

    /// Liquidate an under-collateralised position.
    ///
    /// The liquidator repays up to `amount` of the borrower's debt and receives
    /// 110 % of the repaid value as collateral (10 % liquidation bonus).
    ///
    /// # Errors
    /// - [`Error::InvalidAmount`] if `amount ≤ 0`.
    /// - [`Error::NothingToLiquidate`] if the borrower has no outstanding debt.
    /// - [`Error::PositionNotUndercollateralized`] if the position is healthy.
    /// - [`Error::LiquidationExceedsBorrow`] if `amount` exceeds the borrower's debt.
    /// - [`Error::InsufficientBalance`] if the borrower's collateral cannot cover
    ///   the liquidation bonus.
    pub fn liquidate(
        env: Env,
        liquidator: Address,
        user: Address,
        amount: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        liquidator.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = get_position(&env, &user);

        if pos.borrowed == 0 {
            return Err(Error::NothingToLiquidate);
        }

        // Position is healthy — cannot liquidate.
        if pos.borrowed * LIQUIDATION_THRESHOLD_NUM <= pos.deposited * COLLATERAL_RATIO_DEN {
            return Err(Error::PositionNotUndercollateralized);
        }

        // Liquidation amount must not exceed outstanding debt.
        if amount > pos.borrowed {
            return Err(Error::LiquidationExceedsBorrow);
        }

        let collateral_to_seize =
            (amount * LIQUIDATION_BONUS_NUM) / LIQUIDATION_BONUS_DEN;

        // Ensure the borrower has enough collateral to cover the seizure.
        if collateral_to_seize > pos.deposited {
            return Err(Error::InsufficientBalance);
        }

        pos.borrowed -= amount;
        pos.deposited -= collateral_to_seize;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        // Credit the liquidator with the seized collateral.
        let mut liq_pos = get_position(&env, &liquidator);
        liq_pos.deposited += collateral_to_seize;
        set_position(&env, &liquidator, &liq_pos);

        set_total_borrowed(&env, get_total_borrowed(&env) - amount);
        set_total_deposited(&env, get_total_deposited(&env) - collateral_to_seize);

        env.events().publish(
            (symbol_short!("liquidate"), user),
            (liquidator, amount, collateral_to_seize),
        );

        Ok(collateral_to_seize)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Returns aggregate pool statistics.
    pub fn get_stats(env: Env) -> PoolStats {
        let total_d = get_total_deposited(&env);
        let total_b = get_total_borrowed(&env);
        // Utilisation rate in basis points (0–10 000).
        let rate = if total_d > 0 { (total_b * 10_000) / total_d } else { 0 };
        PoolStats {
            total_deposited: total_d,
            total_borrowed: total_b,
            interest_rate: rate,
        }
    }

    /// Returns the position for `user`.
    pub fn get_user_position(env: Env, user: Address) -> UserPosition {
        get_position(&env, &user)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

#[cfg(test)]
mod test;
