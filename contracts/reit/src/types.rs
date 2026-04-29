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
    PropertyNotFound = 4,
    ZeroShares = 5,
    InsufficientShares = 6,
    ExceedsTotalSupply = 7,
    EmptyName = 8,
    ZeroTotalShares = 9,
    ZeroPrice = 10,
    ZeroDividend = 11,
    NothingToClaim = 12,
    PropertyInactive = 13,
    ContractPaused = 14,
    InvalidRecipient = 15,
}

/// A property held by the REIT portfolio.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Property {
    pub name: String,
    /// Total tokenized shares for this property.
    pub total_shares: u64,
    /// Shares currently held by investors.
    pub shares_issued: u64,
    /// Mint price per share in stroops.
    pub price_per_share: i128,
    /// Cumulative dividends deposited (used for pro-rata snapshot accounting).
    pub total_dividends: i128,
    pub is_active: bool,
}

/// Per-investor share holding for a property.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Holding {
    pub shares: u64,
    /// Dividend snapshot at time of last mint/transfer/claim.
    pub dividends_claimed_snapshot: i128,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    PropertyCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Property(u32),
    Holding(u32, Address),
}
