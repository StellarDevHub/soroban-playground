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
        admin.require_auth();
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
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);
        pos.deposited = pos.deposited.checked_add(amount).ok_or(Error::InvalidAmount)?;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_deposited(&env)
            .checked_add(amount)
            .ok_or(Error::InvalidAmount)?;
        set_total_deposited(&env, new_total);

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
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);
        if pos.deposited < amount {
            return Err(Error::InsufficientBalance);
        }

        let remaining_deposit = pos
            .deposited
            .checked_sub(amount)
            .ok_or(Error::InvalidAmount)?;

        // Ensure remaining collateral still covers outstanding borrows.
        if pos.borrowed > 0 {
            check_collateral_ratio(remaining_deposit, pos.borrowed)?;
        }

        pos.deposited = remaining_deposit;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_deposited(&env)
            .checked_sub(amount)
            .ok_or(Error::InvalidAmount)?;
        set_total_deposited(&env, new_total);

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
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);
        let new_borrowed = pos
            .borrowed
            .checked_add(amount)
            .ok_or(Error::InvalidAmount)?;

        // Check if collateral ratio is maintained: (borrowed + amount) * 150 <= deposited * 100
        check_collateral_ratio(pos.deposited, new_borrowed)?;

        pos.borrowed = new_borrowed;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_borrowed(&env)
            .checked_add(amount)
            .ok_or(Error::InvalidAmount)?;
        set_total_borrowed(&env, new_total);

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
    /// - [`Error::InvalidAmount`] if `amount ≤ 0` or nothing outstanding.
    pub fn repay(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        user.require_auth();
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);

        // Cap repayment at outstanding balance.
        let actual_repay = amount.min(pos.borrowed);
        if actual_repay == 0 {
            // Nothing to repay — treat as invalid amount.
            return Err(Error::InvalidAmount);
        }

        pos.borrowed = pos
            .borrowed
            .checked_sub(actual_repay)
            .ok_or(Error::InvalidAmount)?;
        pos.credit_score = pos
            .credit_score
            .checked_add(CREDIT_SCORE_INCREMENT)
            .ok_or(Error::InvalidAmount)?;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_borrowed(&env)
            .checked_sub(actual_repay)
            .ok_or(Error::InvalidAmount)?;
        set_total_borrowed(&env, new_total);

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
        validate_amount(amount)?;
        if liquidator == user {
            // Without this, a borrower could "liquidate" themselves: the
            // collateral seized from `user` and the collateral credited to
            // `liquidator` are the same storage slot when they're the same
            // address, so the seizure nets to zero while the debt reduction
            // is real — erasing debt for free with no actual repayment.
            return Err(Error::SelfLiquidationNotAllowed);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pos = get_position(&env, &user);

        if pos.borrowed == 0 {
            return Err(Error::NothingToLiquidate);
        }

        // Position is healthy — cannot liquidate if borrowed * 110 <= deposited * 100.
        let liq_req = pos
            .borrowed
            .checked_mul(LIQUIDATION_THRESHOLD_NUM)
            .ok_or(Error::InvalidAmount)?;
        let dep_threshold = pos
            .deposited
            .checked_mul(COLLATERAL_RATIO_DEN)
            .ok_or(Error::InvalidAmount)?;

        if liq_req <= dep_threshold {
            return Err(Error::PositionNotUndercollateralized);
        }

        // Liquidation amount must not exceed outstanding debt.
        if amount > pos.borrowed {
            return Err(Error::LiquidationExceedsBorrow);
        }

        let collateral_to_seize = calculate_liquidation_seizure(amount)?;

        // Ensure the borrower has enough collateral to cover the seizure.
        if collateral_to_seize > pos.deposited {
            return Err(Error::InsufficientBalance);
        }

        pos.borrowed = pos
            .borrowed
            .checked_sub(amount)
            .ok_or(Error::InvalidAmount)?;
        pos.deposited = pos
            .deposited
            .checked_sub(collateral_to_seize)
            .ok_or(Error::InvalidAmount)?;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        // Credit the liquidator with the seized collateral.
        let mut liq_pos = get_position(&env, &liquidator);
        liq_pos.deposited = liq_pos
            .deposited
            .checked_add(collateral_to_seize)
            .ok_or(Error::InvalidAmount)?;
        set_position(&env, &liquidator, &liq_pos);

        let new_total_borrowed = get_total_borrowed(&env)
            .checked_sub(amount)
            .ok_or(Error::InvalidAmount)?;
        set_total_borrowed(&env, new_total_borrowed);

        let new_total_deposited = get_total_deposited(&env)
            .checked_sub(collateral_to_seize)
            .ok_or(Error::InvalidAmount)?;
        set_total_deposited(&env, new_total_deposited);

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
        let rate = calculate_utilization_rate(total_d, total_b);
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

fn validate_amount(amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}

fn check_collateral_ratio(deposited: i128, borrowed: i128) -> Result<(), Error> {
    if borrowed == 0 {
        return Ok(());
    }
    let req_collateral = borrowed
        .checked_mul(COLLATERAL_RATIO_NUM)
        .ok_or(Error::InvalidAmount)?;
    let actual_collateral = deposited
        .checked_mul(COLLATERAL_RATIO_DEN)
        .ok_or(Error::InvalidAmount)?;

    if req_collateral > actual_collateral {
        return Err(Error::InsufficientCollateral);
    }
    Ok(())
}

fn calculate_liquidation_seizure(amount: i128) -> Result<i128, Error> {
    let scaled = amount
        .checked_mul(LIQUIDATION_BONUS_NUM)
        .ok_or(Error::InvalidAmount)?;
    let seized = scaled
        .checked_div(LIQUIDATION_BONUS_DEN)
        .ok_or(Error::InvalidAmount)?;
    Ok(seized)
}

fn calculate_utilization_rate(total_deposited: i128, total_borrowed: i128) -> i128 {
    if total_deposited <= 0 {
        return 0;
    }
    total_borrowed
        .checked_mul(10_000)
        .and_then(|val| val.checked_div(total_deposited))
        .unwrap_or(0)
}

#[cfg(test)]
mod test;
