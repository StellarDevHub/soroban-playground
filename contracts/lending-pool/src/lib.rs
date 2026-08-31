// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Lending Pool — Liquidation Engine with Health-Factor & Bad-Debt Socialization
//!
//! Resolves the production-critical gap identified in issue #1352:
//! undercollateralized positions could not be liquidated atomically during
//! market volatility.
//!
//! ## Health factor
//! ```
//! HF = (deposited * COLLATERAL_FACTOR_BPS / 10_000) / borrowed
//! ```
//! A position with `HF < 1.0` (i.e. `deposited * CF < borrowed * 10_000`)
//! is eligible for liquidation.
//!
//! ## Atomic liquidation
//! The entire liquidation — debt reduction, collateral seizure, bonus transfer
//! and (if necessary) bad-debt socialization — executes in a single contract
//! invocation, preventing partial state that exploits can wedge open.
//!
//! ## Bad-debt socialization
//! If seized collateral < repaid debt (position is insolvent), the deficit is
//! recorded in a global `bad_debt` accumulator. Governance can later write off
//! this amount via `socialize_bad_debt`.
//!
//! ## Liquidation bonus
//! Liquidators receive `LIQUIDATION_BONUS_BPS` (default 500 bps = 5 %) on top
//! of the repaid amount in collateral tokens as an incentive.

#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env,
};

// ── Constants ─────────────────────────────────────────────────────────────────

/// Collateral factor in basis points (default 8000 = 80 %).
/// Effective collateral value = deposited * CF / 10_000.
const COLLATERAL_FACTOR_BPS: i128 = 8_000;
/// Liquidation bonus in basis points (default 500 = 5 %).
const LIQUIDATION_BONUS_BPS: i128 = 500;
/// Basis point denominator.
const BPS_DEN: i128 = 10_000;
/// Maximum single liquidation as a fraction of the borrower's debt (50 %).
const MAX_CLOSE_FACTOR_BPS: i128 = 5_000;

// ── Error codes ───────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    InvalidAmount = 5,
    InsufficientBalance = 6,
    InsufficientCollateral = 7,
    NothingToLiquidate = 8,
    /// Position health factor is ≥ 1; it cannot be liquidated.
    PositionHealthy = 9,
    /// Requested liquidation amount exceeds the close factor cap.
    LiquidationExceedsCloseFactor = 10,
    SelfLiquidationNotAllowed = 11,
    Overflow = 12,
}

// ── Storage types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct UserPosition {
    /// Total tokens deposited as collateral.
    pub deposited: i128,
    /// Total tokens currently borrowed.
    pub borrowed: i128,
    /// Cumulative credit score incremented by repayments.
    pub credit_score: i128,
    /// Last ledger timestamp at which position was modified.
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolStats {
    pub total_deposited: i128,
    pub total_borrowed: i128,
    /// Bad debt not covered by any collateral, in tokens.
    pub bad_debt: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidationResult {
    /// Debt amount actually repaid.
    pub debt_repaid: i128,
    /// Collateral seized and transferred to the liquidator.
    pub collateral_seized: i128,
    /// Liquidation bonus included in collateral_seized (informational).
    pub bonus: i128,
    /// Bad debt written into the global accumulator (0 if position was solvent).
    pub bad_debt_created: i128,
}

// ── Storage helpers ───────────────────────────────────────────────────────────

fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&symbol_short!("init"))
        .unwrap_or(false)
}

fn set_initialized(env: &Env) {
    env.storage()
        .instance()
        .set(&symbol_short!("init"), &true);
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&symbol_short!("admin"))
        .ok_or(Error::NotInitialized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&symbol_short!("admin"), admin);
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&symbol_short!("paused"))
        .unwrap_or(false)
}

fn set_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&symbol_short!("paused"), &paused);
}

fn get_position(env: &Env, user: &Address) -> UserPosition {
    env.storage()
        .persistent()
        .get(&(symbol_short!("pos"), user.clone()))
        .unwrap_or_default()
}

fn set_position(env: &Env, user: &Address, pos: &UserPosition) {
    env.storage()
        .persistent()
        .set(&(symbol_short!("pos"), user.clone()), pos);
}

fn get_total_deposited(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&symbol_short!("tot_dep"))
        .unwrap_or(0)
}

fn set_total_deposited(env: &Env, val: i128) {
    env.storage()
        .instance()
        .set(&symbol_short!("tot_dep"), &val);
}

fn get_total_borrowed(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&symbol_short!("tot_brw"))
        .unwrap_or(0)
}

fn set_total_borrowed(env: &Env, val: i128) {
    env.storage()
        .instance()
        .set(&symbol_short!("tot_brw"), &val);
}

fn get_bad_debt(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&symbol_short!("bad_dbt"))
        .unwrap_or(0)
}

fn set_bad_debt(env: &Env, val: i128) {
    env.storage()
        .instance()
        .set(&symbol_short!("bad_dbt"), &val);
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct LendingPool;

#[contractimpl]
impl LendingPool {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        Ok(())
    }

    // ── Admin: pause / unpause ────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), admin);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), admin);
        Ok(())
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);
        pos.deposited = pos.deposited.checked_add(amount).ok_or(Error::Overflow)?;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_deposited(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        set_total_deposited(&env, new_total);

        env.events()
            .publish((symbol_short!("deposit"), user), amount);
        Ok(())
    }

    // ── Withdraw ──────────────────────────────────────────────────────────────

    pub fn withdraw(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);
        if pos.deposited < amount {
            return Err(Error::InsufficientBalance);
        }
        let remaining = pos
            .deposited
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;

        // After withdrawal the position must still be healthy.
        if pos.borrowed > 0 {
            check_health(remaining, pos.borrowed)?;
        }

        pos.deposited = remaining;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_deposited(&env)
            .checked_sub(amount)
            .ok_or(Error::Overflow)?;
        set_total_deposited(&env, new_total);

        env.events()
            .publish((symbol_short!("withdraw"), user), amount);
        Ok(())
    }

    // ── Borrow ────────────────────────────────────────────────────────────────

    pub fn borrow(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);
        let new_borrowed = pos
            .borrowed
            .checked_add(amount)
            .ok_or(Error::Overflow)?;

        check_health(pos.deposited, new_borrowed)?;

        pos.borrowed = new_borrowed;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_borrowed(&env)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        set_total_borrowed(&env, new_total);

        env.events()
            .publish((symbol_short!("borrow"), user), amount);
        Ok(())
    }

    // ── Repay ─────────────────────────────────────────────────────────────────

    pub fn repay(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        validate_amount(amount)?;

        let mut pos = get_position(&env, &user);
        let actual = amount.min(pos.borrowed);
        if actual == 0 {
            return Err(Error::InvalidAmount);
        }

        pos.borrowed = pos
            .borrowed
            .checked_sub(actual)
            .ok_or(Error::Overflow)?;
        pos.credit_score = pos.credit_score.saturating_add(5);
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = get_total_borrowed(&env)
            .checked_sub(actual)
            .ok_or(Error::Overflow)?;
        set_total_borrowed(&env, new_total);

        env.events()
            .publish((symbol_short!("repay"), user), actual);
        Ok(actual)
    }

    // ── Liquidate ─────────────────────────────────────────────────────────────

    /// Atomically liquidate an undercollateralized position.
    ///
    /// The liquidator repays up to `repay_amount` of the borrower's debt
    /// (capped by the close factor: max 50 % of outstanding debt per call).
    /// They receive collateral worth `repay_amount * (1 + BONUS_BPS/10_000)`.
    ///
    /// If the borrower's collateral is insufficient to cover the full seizure
    /// (insolvent position), the deficit is socialized into `bad_debt`.
    ///
    /// # Errors
    /// - [`Error::SelfLiquidationNotAllowed`] – liquidator == user.
    /// - [`Error::NothingToLiquidate`]        – user has no outstanding debt.
    /// - [`Error::PositionHealthy`]            – health factor ≥ 1.
    /// - [`Error::LiquidationExceedsCloseFactor`] – `repay_amount` > 50 % of debt.
    /// - [`Error::InvalidAmount`]              – `repay_amount` ≤ 0.
    pub fn liquidate(
        env: Env,
        liquidator: Address,
        user: Address,
        repay_amount: i128,
    ) -> Result<LiquidationResult, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        liquidator.require_auth();
        validate_amount(repay_amount)?;

        if liquidator == user {
            return Err(Error::SelfLiquidationNotAllowed);
        }

        let mut borrower = get_position(&env, &user);

        if borrower.borrowed == 0 {
            return Err(Error::NothingToLiquidate);
        }

        // Verify position is actually undercollateralized (HF < 1).
        if is_position_healthy(borrower.deposited, borrower.borrowed) {
            return Err(Error::PositionHealthy);
        }

        // Cap repayment at the close factor (50 % of outstanding debt).
        let max_repay = borrower
            .borrowed
            .checked_mul(MAX_CLOSE_FACTOR_BPS)
            .ok_or(Error::Overflow)?
            .checked_div(BPS_DEN)
            .ok_or(Error::Overflow)?;
        let debt_to_repay = repay_amount.min(max_repay).min(borrower.borrowed);
        if debt_to_repay == 0 {
            return Err(Error::InvalidAmount);
        }
        if repay_amount > max_repay {
            return Err(Error::LiquidationExceedsCloseFactor);
        }

        // Collateral to seize = debt_to_repay * (1 + bonus_bps / 10_000).
        let bonus = debt_to_repay
            .checked_mul(LIQUIDATION_BONUS_BPS)
            .ok_or(Error::Overflow)?
            .checked_div(BPS_DEN)
            .ok_or(Error::Overflow)?;
        let ideal_seizure = debt_to_repay.checked_add(bonus).ok_or(Error::Overflow)?;

        // Actual seizure is capped at available collateral — deficit becomes bad debt.
        let actual_seizure = ideal_seizure.min(borrower.deposited);
        let bad_debt_created = if ideal_seizure > borrower.deposited {
            ideal_seizure - borrower.deposited
        } else {
            0
        };

        // ── State mutations (all-or-nothing within the transaction) ──────────

        borrower.borrowed = borrower
            .borrowed
            .checked_sub(debt_to_repay)
            .ok_or(Error::Overflow)?;
        borrower.deposited = borrower
            .deposited
            .checked_sub(actual_seizure)
            .ok_or(Error::Overflow)?;
        borrower.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &borrower);

        // Credit seized collateral to the liquidator.
        let mut liq_pos = get_position(&env, &liquidator);
        liq_pos.deposited = liq_pos
            .deposited
            .checked_add(actual_seizure)
            .ok_or(Error::Overflow)?;
        set_position(&env, &liquidator, &liq_pos);

        // Update global totals.
        let new_total_borrow = get_total_borrowed(&env)
            .checked_sub(debt_to_repay)
            .ok_or(Error::Overflow)?;
        set_total_borrowed(&env, new_total_borrow);

        let new_total_deposit = get_total_deposited(&env)
            .checked_sub(actual_seizure)
            .ok_or(Error::Overflow)?;
        set_total_deposited(&env, new_total_deposit);

        // Accumulate bad debt if the position was insolvent.
        if bad_debt_created > 0 {
            let current_bad_debt = get_bad_debt(&env);
            let new_bad_debt = current_bad_debt
                .checked_add(bad_debt_created)
                .ok_or(Error::Overflow)?;
            set_bad_debt(&env, new_bad_debt);
        }

        let result = LiquidationResult {
            debt_repaid: debt_to_repay,
            collateral_seized: actual_seizure,
            bonus: actual_seizure.saturating_sub(debt_to_repay),
            bad_debt_created,
        };

        env.events().publish(
            (symbol_short!("liquidate"), user.clone()),
            (liquidator, debt_to_repay, actual_seizure, bad_debt_created),
        );

        Ok(result)
    }

    // ── Bad-debt governance ───────────────────────────────────────────────────

    /// Admin write-off: reduce the bad-debt accumulator by `amount`.
    /// Used after off-chain deficit coverage (e.g. insurance fund).
    pub fn socialize_bad_debt(env: Env, admin: Address, amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        validate_amount(amount)?;

        let current = get_bad_debt(&env);
        let reduced = current.saturating_sub(amount);
        set_bad_debt(&env, reduced);

        env.events()
            .publish((symbol_short!("bd_socl"),), (amount, reduced));
        Ok(reduced)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Returns aggregate pool statistics including bad-debt accumulator.
    pub fn get_stats(env: Env) -> PoolStats {
        PoolStats {
            total_deposited: get_total_deposited(&env),
            total_borrowed: get_total_borrowed(&env),
            bad_debt: get_bad_debt(&env),
        }
    }

    pub fn get_user_position(env: Env, user: Address) -> UserPosition {
        get_position(&env, &user)
    }

    /// Returns the position's health factor scaled by 10_000.
    /// Values < 10_000 indicate undercollateralization.
    pub fn get_health_factor(env: Env, user: Address) -> i128 {
        let pos = get_position(&env, &user);
        if pos.borrowed == 0 {
            return i128::MAX;
        }
        health_factor_scaled(pos.deposited, pos.borrowed)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn validate_amount(amount: i128) -> Result<(), Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(())
}

/// Health factor scaled by 10_000.
/// HF_scaled = deposited * CF_BPS / borrowed
/// Healthy when HF_scaled >= 10_000.
fn health_factor_scaled(deposited: i128, borrowed: i128) -> i128 {
    if borrowed == 0 {
        return i128::MAX;
    }
    deposited
        .saturating_mul(COLLATERAL_FACTOR_BPS)
        .checked_div(borrowed)
        .unwrap_or(0)
}

/// Returns `true` when the position is healthy (HF >= 1).
fn is_position_healthy(deposited: i128, borrowed: i128) -> bool {
    health_factor_scaled(deposited, borrowed) >= BPS_DEN
}

/// Ensures that after a borrow or withdrawal the position remains healthy.
fn check_health(deposited: i128, borrowed: i128) -> Result<(), Error> {
    if !is_position_healthy(deposited, borrowed) {
        return Err(Error::InsufficientCollateral);
    }
    Ok(())
}
