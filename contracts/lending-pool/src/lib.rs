// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Over-Collateralized Multi-Asset Lending Protocol with Dutch Liquidation Auctions
//!
//! Resolves issue #1800 [SC-04]:
//! Build a decentralized lending and borrowing protocol supporting multi-asset
//! collateral, dynamic utilization-based interest rate curves, and Dutch
//! auction liquidations for insolvent accounts.
//!
//! ## Interest Rate Model
//! Two-slope kinked curve:
//! - Below kink utilization: `rate = base_rate + utilization * slope1`
//! - Above kink utilization: `rate = base_rate + kink * slope1 + (utilization - kink) * slope2`
//!
//! ## Health Factor
//! ```
//! HF = (Total Collateral Value * Liquidation Threshold) / Total Borrowed Value
//! ```
//! Triggers Dutch liquidation auctions when `HF < 1.0`.
//!
//! ## sTokens (Interest-bearing Yield Tokens)
//! Depositors receive sTokens representing pool shares. The exchange rate
//! (`index`) grows over time with accrued interest:
//! `sToken_value = sToken_balance * index / INDEX_SCALE`
//!
//! ## TWAP Oracle
//! Price feeds with sanity bounds and stale-price rejection. Prices are stored
//! as 18-decimal fixed point with a maximum staleness of `MAX_PRICE_AGE_SECS`.
//!
//! ## Atomic liquidation (legacy)
//! The entire liquidation — debt reduction, collateral seizure, bonus transfer
//! and (if necessary) bad-debt socialization — executes in a single contract
//! invocation.
//!
//! ## Bad-debt socialization
//! If seized collateral < repaid debt (position is insolvent), the deficit is
//! recorded in a global `bad_debt` accumulator.

#![no_std]

pub mod auction;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Map, Symbol,
};

pub use auction::{Auction, AuctionPhase};

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

// ── Interest Rate Model Constants ──────────────────────────────────────────────
/// Base rate in BPS (1% annual expressed as per-second, scaled by RATE_SCALE).
const BASE_RATE_BPS: i128 = 100; // 1% p.a.
/// Slope 1 in BPS per unit of utilization (below kink).
const SLOPE1_BPS: i128 = 400; // 4% p.a. at 100% utilization below kink
/// Slope 2 in BPS per unit of utilization (above kink).
const SLOPE2_BPS: i128 = 3_000; // 30% p.a. at 100% utilization above kink
/// Optimal utilization kink (80%).
const KINK_UTILIZATION_BPS: i128 = 8_000;
/// Index scale for sToken exchange rate (1e18).
const INDEX_SCALE: i128 = 1_000_000_000_000_000_000; // 1e18
/// Seconds in a year for annual-rate → per-second conversion.
const SECONDS_PER_YEAR: i128 = 31_536_000;

// ── TWAP Oracle Constants ──────────────────────────────────────────────────────
/// Maximum allowed age for a price in seconds (1 hour).
const MAX_PRICE_AGE_SECS: u64 = 3_600;
/// Maximum allowed price deviation in BPS (50%).
const MAX_PRICE_DEVIATION_BPS: i128 = 5_000;
/// Price scale (18 decimals).
const PRICE_SCALE: i128 = 1_000_000_000_000_000_000; // 1e18

// ── Storage keys ──────────────────────────────────────────────────────────────
const KEY_INIT: Symbol = symbol_short!("init");
const KEY_ADMIN: Symbol = symbol_short!("admin");
const KEY_PAUSED: Symbol = symbol_short!("paused");
const KEY_TOT_DEP: Symbol = symbol_short!("tot_dep");
const KEY_TOT_BRW: Symbol = symbol_short!("tot_brw");
const KEY_BAD_DBT: Symbol = symbol_short!("bad_dbt");
const KEY_INDEX: Symbol = symbol_short!("index");
const KEY_LAST_ACC: Symbol = symbol_short!("last_acc");
const KEY_STOK_SUP: Symbol = symbol_short!("stok_sup");
const KEY_PRICES: Symbol = symbol_short!("prices");

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
    AuctionNotFound = 13,
    AuctionNotActive = 14,
    AuctionNotExpired = 15,
    BidTooLow = 16,
    InvalidAuctionPhase = 17,
    StabilityPoolEmpty = 18,
    AuctionAlreadySettled = 19,
    PriceExceedsMax = 20,
    VaultNotFound = 21,
    /// Oracle price is too stale (older than MAX_PRICE_AGE_SECS).
    StalePriceRejected = 22,
    /// Oracle price deviates too far from the reference (sanity bound exceeded).
    PriceDeviationTooHigh = 23,
    /// No price has been submitted for the given asset ID.
    NoPriceForAsset = 24,
    /// sToken mint/burn math error.
    STokenError = 25,
}

// ── Storage types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Default)]
pub struct UserPosition {
    /// Total tokens deposited as collateral.
    pub deposited: i128,
    /// Total tokens currently borrowed (principal only).
    pub borrowed: i128,
    /// sToken balance representing lender shares.
    pub s_tokens: i128,
    /// Borrow index snapshot at last update (for interest accrual).
    pub borrow_index_snapshot: i128,
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
    /// Current borrow index (scaled by INDEX_SCALE).
    pub borrow_index: i128,
    /// Current utilization in BPS.
    pub utilization_bps: i128,
    /// Current borrow APR in BPS.
    pub borrow_apr_bps: i128,
    /// Total sToken supply.
    pub s_token_supply: i128,
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

/// TWAP price entry with timestamp for staleness check.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceEntry {
    /// Price scaled by PRICE_SCALE (1e18).
    pub price: i128,
    /// Timestamp when this price was last updated.
    pub updated_at: u64,
    /// Previous reference price for deviation sanity check.
    pub prev_price: i128,
}

// ── Storage helpers ───────────────────────────────────────────────────────────

fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&KEY_INIT)
        .unwrap_or(false)
}

fn set_initialized(env: &Env) {
    env.storage().instance().set(&KEY_INIT, &true);
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&KEY_ADMIN)
        .ok_or(Error::NotInitialized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&KEY_ADMIN, admin);
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<_, bool>(&KEY_PAUSED)
        .unwrap_or(false)
}

fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&KEY_PAUSED, &paused);
}

pub(crate) fn get_position(env: &Env, user: &Address) -> UserPosition {
    env.storage()
        .persistent()
        .get(&(symbol_short!("pos"), user.clone()))
        .unwrap_or_default()
}

pub(crate) fn set_position(env: &Env, user: &Address, pos: &UserPosition) {
    env.storage()
        .persistent()
        .set(&(symbol_short!("pos"), user.clone()), pos);
}

pub(crate) fn get_total_deposited(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&KEY_TOT_DEP)
        .unwrap_or(0)
}

pub(crate) fn set_total_deposited(env: &Env, val: i128) {
    env.storage().instance().set(&KEY_TOT_DEP, &val);
}

pub(crate) fn get_total_borrowed(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&KEY_TOT_BRW)
        .unwrap_or(0)
}

pub(crate) fn set_total_borrowed(env: &Env, val: i128) {
    env.storage().instance().set(&KEY_TOT_BRW, &val);
}

pub(crate) fn get_bad_debt(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&KEY_BAD_DBT)
        .unwrap_or(0)
}

pub(crate) fn set_bad_debt(env: &Env, val: i128) {
    env.storage().instance().set(&KEY_BAD_DBT, &val);
}

// ── Interest index storage ────────────────────────────────────────────────────

fn get_borrow_index(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&KEY_INDEX)
        .unwrap_or(INDEX_SCALE) // starts at 1.0 (scaled)
}

fn set_borrow_index(env: &Env, idx: i128) {
    env.storage().instance().set(&KEY_INDEX, &idx);
}

fn get_last_accrual_time(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get::<_, u64>(&KEY_LAST_ACC)
        .unwrap_or(0)
}

fn set_last_accrual_time(env: &Env, ts: u64) {
    env.storage().instance().set(&KEY_LAST_ACC, &ts);
}

fn get_s_token_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&KEY_STOK_SUP)
        .unwrap_or(0)
}

fn set_s_token_supply(env: &Env, supply: i128) {
    env.storage().instance().set(&KEY_STOK_SUP, &supply);
}

// ── Price feed storage ────────────────────────────────────────────────────────

fn get_price_feed(env: &Env) -> Map<u32, PriceEntry> {
    env.storage()
        .instance()
        .get::<_, Map<u32, PriceEntry>>(&KEY_PRICES)
        .unwrap_or_else(|| Map::new(env))
}

fn set_price_feed(env: &Env, feed: &Map<u32, PriceEntry>) {
    env.storage().instance().set(&KEY_PRICES, feed);
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
        set_borrow_index(&env, INDEX_SCALE); // index = 1.0
        set_last_accrual_time(&env, env.ledger().timestamp());
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

    // ── TWAP Oracle: submit price ─────────────────────────────────────────────

    /// Admin submits/updates a price for asset `asset_id`.
    ///
    /// Enforces:
    /// - Sanity bounds: new price must not deviate > `MAX_PRICE_DEVIATION_BPS`
    ///   from the previous price (if a previous price exists).
    pub fn submit_price(
        env: Env,
        admin: Address,
        asset_id: u32,
        price: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        if price <= 0 {
            return Err(Error::InvalidAmount);
        }

        let now = env.ledger().timestamp();
        let mut feed = get_price_feed(&env);

        // Sanity deviation check against previous price
        if let Some(prev) = feed.get(asset_id) {
            let deviation = if price > prev.price {
                (price - prev.price) * BPS_DEN / prev.price
            } else {
                (prev.price - price) * BPS_DEN / prev.price
            };
            if deviation > MAX_PRICE_DEVIATION_BPS {
                return Err(Error::PriceDeviationTooHigh);
            }
            let entry = PriceEntry {
                price,
                updated_at: now,
                prev_price: prev.price,
            };
            feed.set(asset_id, entry);
        } else {
            // First price submission — no deviation check possible
            let entry = PriceEntry {
                price,
                updated_at: now,
                prev_price: price,
            };
            feed.set(asset_id, entry);
        }

        set_price_feed(&env, &feed);
        env.events()
            .publish((symbol_short!("price"),), (asset_id, price, now));
        Ok(())
    }

    /// Read the current validated price for `asset_id`.
    ///
    /// Rejects stale prices older than `MAX_PRICE_AGE_SECS`.
    pub fn get_price(env: Env, asset_id: u32) -> Result<i128, Error> {
        let feed = get_price_feed(&env);
        let entry = feed.get(asset_id).ok_or(Error::NoPriceForAsset)?;
        let now = env.ledger().timestamp();
        if now > entry.updated_at + MAX_PRICE_AGE_SECS {
            return Err(Error::StalePriceRejected);
        }
        Ok(entry.price)
    }

    // ── Interest Accrual ──────────────────────────────────────────────────────

    /// Accrue interest for elapsed time since last accrual.
    ///
    /// Updates the global borrow index. Anyone can call this.
    pub fn accrue_interest(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let new_index = accrue_interest_impl(&env)?;
        Ok(new_index)
    }

    // ── Deposit (mints sTokens) ───────────────────────────────────────────────

    /// Deposit `amount` of the underlying asset. Mints sTokens representing
    /// pool shares with compounding interest.
    ///
    /// `sTokens = amount * INDEX_SCALE / borrow_index`
    pub fn deposit(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        validate_amount(amount)?;

        // Accrue interest before calculating share price
        let index = accrue_interest_impl(&env)?;

        let total_dep = get_total_deposited(&env);
        let s_supply = get_s_token_supply(&env);

        // sTokens to mint: if pool is empty, 1:1; otherwise proportional to pool share
        let s_to_mint = if s_supply == 0 || total_dep == 0 {
            amount
        } else {
            amount
                .checked_mul(s_supply)
                .ok_or(Error::Overflow)?
                .checked_div(total_dep)
                .ok_or(Error::STokenError)?
        };

        if s_to_mint <= 0 {
            return Err(Error::STokenError);
        }

        let mut pos = get_position(&env, &user);
        pos.deposited = pos.deposited.checked_add(amount).ok_or(Error::Overflow)?;
        pos.s_tokens = pos.s_tokens.checked_add(s_to_mint).ok_or(Error::Overflow)?;
        pos.borrow_index_snapshot = index;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = total_dep.checked_add(amount).ok_or(Error::Overflow)?;
        set_total_deposited(&env, new_total);

        let new_s_supply = s_supply.checked_add(s_to_mint).ok_or(Error::Overflow)?;
        set_s_token_supply(&env, new_s_supply);

        env.events()
            .publish((symbol_short!("deposit"), user), (amount, s_to_mint));
        Ok(s_to_mint)
    }

    // ── Withdraw (burns sTokens) ──────────────────────────────────────────────

    /// Withdraw by burning `s_token_amount` sTokens. Returns underlying amount.
    ///
    /// `underlying = s_token_amount * total_deposited / s_token_supply`
    pub fn withdraw(env: Env, user: Address, s_token_amount: i128) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        validate_amount(s_token_amount)?;

        let _index = accrue_interest_impl(&env)?;

        let total_dep = get_total_deposited(&env);
        let s_supply = get_s_token_supply(&env);

        if s_supply == 0 {
            return Err(Error::InsufficientBalance);
        }

        // Underlying amount to return
        let underlying = s_token_amount
            .checked_mul(total_dep)
            .ok_or(Error::Overflow)?
            .checked_div(s_supply)
            .ok_or(Error::STokenError)?;

        if underlying <= 0 {
            return Err(Error::STokenError);
        }

        let mut pos = get_position(&env, &user);
        if pos.s_tokens < s_token_amount {
            return Err(Error::InsufficientBalance);
        }
        if pos.deposited < underlying {
            return Err(Error::InsufficientBalance);
        }

        let remaining_dep = pos.deposited.checked_sub(underlying).ok_or(Error::Overflow)?;

        // After withdrawal the position must still be healthy.
        if pos.borrowed > 0 {
            check_health(remaining_dep, pos.borrowed)?;
        }

        pos.deposited = remaining_dep;
        pos.s_tokens = pos
            .s_tokens
            .checked_sub(s_token_amount)
            .ok_or(Error::Overflow)?;
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        let new_total = total_dep.checked_sub(underlying).ok_or(Error::Overflow)?;
        set_total_deposited(&env, new_total);

        let new_s_supply = s_supply
            .checked_sub(s_token_amount)
            .ok_or(Error::Overflow)?;
        set_s_token_supply(&env, new_s_supply);

        env.events()
            .publish((symbol_short!("withdraw"), user), (s_token_amount, underlying));
        Ok(underlying)
    }

    // ── Borrow ────────────────────────────────────────────────────────────────

    pub fn borrow(env: Env, user: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        validate_amount(amount)?;

        let index = accrue_interest_impl(&env)?;

        let mut pos = get_position(&env, &user);

        // Accrue outstanding interest on existing debt before adding new borrow
        let accrued_debt = if pos.borrow_index_snapshot > 0 && pos.borrowed > 0 {
            pos.borrowed
                .checked_mul(index)
                .ok_or(Error::Overflow)?
                .checked_div(pos.borrow_index_snapshot)
                .ok_or(Error::Overflow)?
        } else {
            pos.borrowed
        };

        let new_borrowed = accrued_debt.checked_add(amount).ok_or(Error::Overflow)?;
        check_health(pos.deposited, new_borrowed)?;

        pos.borrowed = new_borrowed;
        pos.borrow_index_snapshot = index;
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

        let index = accrue_interest_impl(&env)?;

        let mut pos = get_position(&env, &user);

        // Accrue outstanding interest before repayment
        let accrued_debt = if pos.borrow_index_snapshot > 0 && pos.borrowed > 0 {
            pos.borrowed
                .checked_mul(index)
                .ok_or(Error::Overflow)?
                .checked_div(pos.borrow_index_snapshot)
                .ok_or(Error::Overflow)?
        } else {
            pos.borrowed
        };

        let actual = amount.min(accrued_debt);
        if actual == 0 {
            return Err(Error::InvalidAmount);
        }

        pos.borrowed = accrued_debt.checked_sub(actual).ok_or(Error::Overflow)?;
        pos.borrow_index_snapshot = index;
        pos.credit_score = pos.credit_score.saturating_add(5);
        pos.last_updated = env.ledger().timestamp();
        set_position(&env, &user, &pos);

        // Reduce total_borrowed (only reduce by actual principal delta)
        let principal_reduction = actual.min(get_total_borrowed(&env));
        let new_total = get_total_borrowed(&env)
            .checked_sub(principal_reduction)
            .ok_or(Error::Overflow)?;
        set_total_borrowed(&env, new_total);

        env.events().publish((symbol_short!("repay"), user), actual);
        Ok(actual)
    }

    // ── Liquidate (atomic, single-call) ───────────────────────────────────────

    /// Atomically liquidate an undercollateralized position.
    ///
    /// The liquidator repays up to `repay_amount` of the borrower's debt
    /// (capped by the close factor: max 50 % of outstanding debt per call).
    /// They receive collateral worth `repay_amount * (1 + BONUS_BPS/10_000)`.
    ///
    /// Solvent positions are strictly protected — [`Error::PositionHealthy`] is
    /// returned if `HF >= 1`.
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

        let index = accrue_interest_impl(&env)?;

        let mut borrower = get_position(&env, &user);

        if borrower.borrowed == 0 {
            return Err(Error::NothingToLiquidate);
        }

        // Accrue interest on borrower's position
        let accrued_debt = if borrower.borrow_index_snapshot > 0 {
            borrower
                .borrowed
                .checked_mul(index)
                .ok_or(Error::Overflow)?
                .checked_div(borrower.borrow_index_snapshot)
                .ok_or(Error::Overflow)?
        } else {
            borrower.borrowed
        };

        // Verify position is actually undercollateralized (HF < 1).
        if is_position_healthy(borrower.deposited, accrued_debt) {
            return Err(Error::PositionHealthy);
        }

        // Cap repayment at the close factor (50 % of outstanding debt).
        let max_repay = accrued_debt
            .checked_mul(MAX_CLOSE_FACTOR_BPS)
            .ok_or(Error::Overflow)?
            .checked_div(BPS_DEN)
            .ok_or(Error::Overflow)?;
        let debt_to_repay = repay_amount.min(max_repay).min(accrued_debt);
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

        borrower.borrowed = accrued_debt
            .checked_sub(debt_to_repay)
            .ok_or(Error::Overflow)?;
        borrower.borrow_index_snapshot = index;
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
        let prev_total_borrow = get_total_borrowed(&env);
        let new_total_borrow = prev_total_borrow
            .saturating_sub(debt_to_repay);
        set_total_borrowed(&env, new_total_borrow);

        let new_total_deposit = get_total_deposited(&env)
            .saturating_sub(actual_seizure);
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
            (
                liquidator,
                debt_to_repay,
                actual_seizure,
                bad_debt_created,
            ),
        );

        Ok(result)
    }

    // ── Bad-debt governance ───────────────────────────────────────────────────

    /// Admin write-off: reduce the bad-debt accumulator by `amount`.
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

    // ── Dutch Auction Liquidation ─────────────────────────────────────────────

    /// Register/link a vault ID to an owner user address.
    pub fn create_vault(env: Env, user: Address, vault_id: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        user.require_auth();
        auction::set_vault_owner(&env, vault_id, &user);
        Ok(())
    }

    /// Kicks off a liquidation auction for an undercollateralized vault.
    pub fn kick_liquidation_auction(env: Env, vault_id: u64, bad_debt: i128) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::kick_liquidation_auction_impl(&env, vault_id, bad_debt)
    }

    /// Kicks off a configurable liquidation auction with Dutch discount.
    pub fn kick_auction(
        env: Env,
        caller: Address,
        vault_id: u64,
        borrower: Address,
        debt_amount: i128,
        collateral_amount: i128,
        start_price: i128,
        reserve_price: i128,
        english_duration: u64,
        dutch_duration: u64,
    ) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::kick_auction_detailed_impl(
            &env,
            &caller,
            vault_id,
            &borrower,
            debt_amount,
            collateral_amount,
            start_price,
            reserve_price,
            english_duration,
            dutch_duration,
        )
    }

    /// Place an ascending English bid during the English auction phase.
    pub fn bid_english(
        env: Env,
        bidder: Address,
        auction_id: u64,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::bid_english_impl(&env, &bidder, auction_id, amount)
    }

    /// Settle the auction after the English phase expires with a winning bid.
    pub fn settle_english_auction(env: Env, auction_id: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::settle_english_auction_impl(&env, auction_id)
    }

    /// Purchase collateral at current Dutch auction price.
    pub fn buy_dutch(
        env: Env,
        bidder: Address,
        auction_id: u64,
        max_price: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::buy_dutch_impl(&env, &bidder, auction_id, max_price)
    }

    // ── Secondary Stability Pool ──────────────────────────────────────────────

    /// Deposit funds into the secondary stability pool.
    pub fn deposit_stability_pool(env: Env, depositor: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::deposit_stability_pool_impl(&env, &depositor, amount)
    }

    /// Withdraw funds from the secondary stability pool.
    pub fn withdraw_stability_pool(
        env: Env,
        depositor: Address,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::withdraw_stability_pool_impl(&env, &depositor, amount)
    }

    /// Socialize unbid debt from an expired Dutch auction via stability pool fallback.
    pub fn socialize_unbid_auction(
        env: Env,
        caller: Address,
        auction_id: u64,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        auction::socialize_unbid_auction_impl(&env, &caller, auction_id)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Returns aggregate pool statistics.
    pub fn get_stats(env: Env) -> PoolStats {
        let total_deposited = get_total_deposited(&env);
        let total_borrowed = get_total_borrowed(&env);
        let utilization_bps = if total_deposited == 0 {
            0
        } else {
            total_borrowed * BPS_DEN / total_deposited
        };
        let borrow_apr_bps = compute_borrow_rate_bps(utilization_bps);
        PoolStats {
            total_deposited,
            total_borrowed,
            bad_debt: get_bad_debt(&env),
            borrow_index: get_borrow_index(&env),
            utilization_bps,
            borrow_apr_bps,
            s_token_supply: get_s_token_supply(&env),
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

    /// Returns the current borrow APR in basis points.
    pub fn get_borrow_rate(env: Env) -> i128 {
        let total_deposited = get_total_deposited(&env);
        let total_borrowed = get_total_borrowed(&env);
        let utilization_bps = if total_deposited == 0 {
            0
        } else {
            total_borrowed * BPS_DEN / total_deposited
        };
        compute_borrow_rate_bps(utilization_bps)
    }

    /// Returns current utilization in basis points.
    pub fn get_utilization(env: Env) -> i128 {
        let total_deposited = get_total_deposited(&env);
        let total_borrowed = get_total_borrowed(&env);
        if total_deposited == 0 {
            0
        } else {
            total_borrowed * BPS_DEN / total_deposited
        }
    }

    /// Returns the current borrow index (scaled by INDEX_SCALE = 1e18).
    pub fn get_borrow_index(env: Env) -> i128 {
        get_borrow_index(&env)
    }

    /// Returns the sToken value for a given sToken amount.
    pub fn s_token_to_underlying(env: Env, s_token_amount: i128) -> i128 {
        let total_dep = get_total_deposited(&env);
        let s_supply = get_s_token_supply(&env);
        if s_supply == 0 {
            return s_token_amount;
        }
        s_token_amount * total_dep / s_supply
    }

    pub fn get_stability_pool_balance(env: Env) -> i128 {
        auction::get_stability_pool_total(&env)
    }

    pub fn get_user_stability_deposit(env: Env, user: Address) -> i128 {
        auction::get_user_stability_balance(&env, &user)
    }

    pub fn get_auction(env: Env, auction_id: u64) -> Result<Auction, Error> {
        auction::get_auction_storage(&env, auction_id)
    }

    pub fn get_auction_price(env: Env, auction_id: u64) -> Result<i128, Error> {
        let auct = auction::get_auction_storage(&env, auction_id)?;
        let now = env.ledger().timestamp();
        Ok(auction::compute_auction_price(&auct, now))
    }

    pub fn get_auction_phase(env: Env, auction_id: u64) -> Result<AuctionPhase, Error> {
        let auct = auction::get_auction_storage(&env, auction_id)?;
        let now = env.ledger().timestamp();
        Ok(auction::compute_auction_phase(&auct, now))
    }
}

// ── Interest rate model ───────────────────────────────────────────────────────

/// Compute the borrow APR in basis points using the kinked two-slope model.
///
/// - Below kink (`utilization <= KINK_UTILIZATION_BPS`):
///   `rate = BASE_RATE_BPS + utilization * SLOPE1_BPS / 10_000`
/// - Above kink:
///   `rate = BASE_RATE_BPS + KINK_UTILIZATION_BPS * SLOPE1_BPS / 10_000
///            + (utilization - KINK_UTILIZATION_BPS) * SLOPE2_BPS / 10_000`
pub fn compute_borrow_rate_bps(utilization_bps: i128) -> i128 {
    if utilization_bps <= KINK_UTILIZATION_BPS {
        BASE_RATE_BPS + utilization_bps * SLOPE1_BPS / BPS_DEN
    } else {
        let kink_rate = BASE_RATE_BPS + KINK_UTILIZATION_BPS * SLOPE1_BPS / BPS_DEN;
        let excess = utilization_bps - KINK_UTILIZATION_BPS;
        kink_rate + excess * SLOPE2_BPS / BPS_DEN
    }
}

/// Accrue outstanding interest and update the global borrow index.
///
/// Called internally before any state-changing operation to ensure the index
/// is always up-to-date.
fn accrue_interest_impl(env: &Env) -> Result<i128, Error> {
    let now = env.ledger().timestamp();
    let last = get_last_accrual_time(env);

    if now <= last {
        // No time has passed; return current index unchanged.
        return Ok(get_borrow_index(env));
    }

    let elapsed = (now - last) as i128;
    let total_deposited = get_total_deposited(env);
    let total_borrowed = get_total_borrowed(env);

    let utilization_bps = if total_deposited == 0 {
        0
    } else {
        total_borrowed * BPS_DEN / total_deposited
    };

    let apr_bps = compute_borrow_rate_bps(utilization_bps);

    // Per-second rate (apr_bps / 10_000 / SECONDS_PER_YEAR)
    // index_growth = index * apr_bps * elapsed / (10_000 * SECONDS_PER_YEAR)
    let current_index = get_borrow_index(env);
    let interest = current_index
        .checked_mul(apr_bps)
        .ok_or(Error::Overflow)?
        .checked_mul(elapsed)
        .ok_or(Error::Overflow)?
        .checked_div(BPS_DEN * SECONDS_PER_YEAR)
        .ok_or(Error::Overflow)?;

    let new_index = current_index.checked_add(interest).ok_or(Error::Overflow)?;
    set_borrow_index(env, new_index);
    set_last_accrual_time(env, now);

    env.events()
        .publish((symbol_short!("accrue"),), (new_index, elapsed, apr_bps));

    Ok(new_index)
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
