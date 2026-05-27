// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized             = 1,
    NotInitialized                 = 2,
    /// Amount must be greater than zero.
    InvalidAmount                  = 3,
    /// User does not have enough deposited balance for this operation.
    InsufficientBalance            = 4,
    /// Borrow or withdrawal would breach the minimum collateral ratio.
    InsufficientCollateral         = 5,
    /// Liquidation attempted on a healthy (sufficiently collateralised) position.
    PositionNotUndercollateralized = 6,
    /// Caller is not the contract admin.
    Unauthorized                   = 7,
    /// Repay amount exceeds the outstanding borrow balance.
    RepayExceedsBorrow             = 8,
    /// Liquidation amount exceeds the borrower's outstanding debt.
    LiquidationExceedsBorrow       = 9,
    /// Borrower has no outstanding debt to liquidate.
    NothingToLiquidate             = 10,
}

// ── Data types ────────────────────────────────────────────────────────────────

/// Per-user lending position.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UserPosition {
    /// Total tokens deposited as collateral.
    pub deposited: i128,
    /// Total tokens currently borrowed.
    pub borrowed: i128,
    /// Ledger timestamp of the last state change.
    pub last_updated: u64,
    /// Cumulative credit score incremented on each repayment.
    pub credit_score: i128,
}

/// Aggregate pool statistics.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PoolStats {
    pub total_deposited: i128,
    pub total_borrowed: i128,
    /// Utilisation-based interest rate in basis points.
    pub interest_rate: i128,
}
