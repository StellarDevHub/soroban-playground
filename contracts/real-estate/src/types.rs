// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract already initialized.
    AlreadyInitialized = 1,
    /// Contract not yet initialized.
    NotInitialized = 2,
    /// Caller is not the admin.
    Unauthorized = 3,
    /// Property does not exist.
    PropertyNotFound = 4,
    /// Investor has no shares in this property.
    NoShares = 5,
    /// Share amount must be greater than zero.
    ZeroShares = 6,
    /// Transfer amount exceeds owned shares.
    InsufficientShares = 7,
    /// Total shares would exceed the property's total supply.
    ExceedsTotalSupply = 8,
    /// Property name must not be empty.
    EmptyName = 9,
    /// Total shares must be greater than zero.
    ZeroTotalShares = 10,
    /// Price per share must be greater than zero.
    ZeroPrice = 11,
    /// Rental income must be greater than zero.
    ZeroRental = 12,
    /// No rental income available to claim.
    NothingToClaim = 13,
    /// Property is not listed for sale.
    NotForSale = 14,
}

/// A tokenized real estate property.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Property {
    /// Human-readable name / address.
    pub name: String,
    /// Total fractional shares representing 100% ownership.
    pub total_shares: u64,
    /// Shares already sold to investors.
    pub shares_sold: u64,
    /// Price per share in stroops.
    pub price_per_share: i128,
    /// Accumulated rental income not yet distributed (in stroops).
    pub pending_rental: i128,
    /// Total rental income ever deposited (used for pro-rata calculation).
    pub total_rental_deposited: i128,
    /// Whether the property is listed for investment.
    pub is_listed: bool,
}

/// Tracks an investor's fractional ownership in a property.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Ownership {
    /// Number of shares held.
    pub shares: u64,
    /// Rental income already claimed by this investor (snapshot for pro-rata).
    pub rental_claimed: i128,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    PropertyCount,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Property(u32),
    /// Ownership record: (property_id, investor).
    Ownership(u32, Address),
}
