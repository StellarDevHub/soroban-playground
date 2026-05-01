// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    TrustNotFound = 4,
    NoShares = 5,
    ZeroShares = 6,
    InsufficientShares = 7,
    ExceedsTotalSupply = 8,
    EmptyName = 9,
    ZeroTotalShares = 10,
    ZeroPrice = 11,
    ZeroDividend = 12,
    NothingToClaim = 13,
    NotActive = 14,
    ContractPaused = 15,
}

/// A tokenized Real Estate Investment Trust.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReitTrust {
    /// Human-readable name of the REIT.
    pub name: String,
    /// Total fractional shares representing 100% ownership.
    pub total_shares: u64,
    /// Shares already sold to investors.
    pub shares_sold: u64,
    /// Price per share in stroops.
    pub price_per_share: i128,
    /// Total dividend income ever deposited (used for pro-rata calculation).
    pub total_dividends_deposited: i128,
    /// Annual yield rate in basis points (e.g. 500 = 5.00%).
    pub annual_yield_bps: u32,
    /// Whether the trust is active for investment.
    pub is_active: bool,
}

/// Tracks an investor's fractional ownership in a REIT.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Holding {
    /// Number of shares held.
    pub shares: u64,
    /// Dividend income snapshot at time of last claim/purchase (for pro-rata).
    pub dividends_claimed: i128,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    TrustCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Trust(u32),
    Holding(u32, Address),
}
