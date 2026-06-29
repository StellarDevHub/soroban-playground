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
    ProductNotFound = 4,
    PolicyNotFound = 5,
    ProductInactive = 6,
    PolicyExpired = 7,
    PolicyAlreadyClaimed = 8,
    TriggerNotMet = 9,
    ZeroPremium = 10,
    ZeroCoverage = 11,
    InvalidTrigger = 12,
    UnknownOracle = 13,
    OracleDataStale = 14,
    EmptyName = 15,
    PolicyNotActive = 16,
}

/// Direction of the trigger comparison.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum TriggerDirection {
    /// Payout if oracle_value >= threshold (e.g. temperature too high).
    AtOrAbove = 0,
    /// Payout if oracle_value <= threshold (e.g. rainfall too low).
    AtOrBelow = 1,
}

/// Lifecycle state of a policy.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PolicyStatus {
    Active = 0,
    Claimed = 1,
    Expired = 2,
}

/// A parametric insurance product template defined by the admin.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Product {
    /// Human-readable name (e.g. "Drought Cover – Kenya").
    pub name: String,
    /// Premium paid by the policyholder (in stroops).
    pub premium: i128,
    /// Maximum payout amount (in stroops).
    pub coverage_amount: i128,
    /// Authorised oracle address for this product.
    pub oracle: Address,
    /// The parameter key the oracle reports (e.g. "RAINFALL_MM").
    pub parameter_key: String,
    /// Threshold value that must be breached to trigger payout (scaled ×10^7).
    pub trigger_threshold: i128,
    /// Whether the trigger fires above or below the threshold.
    pub trigger_direction: TriggerDirection,
    /// Policy duration in seconds.
    pub term_secs: u64,
    /// Whether new policies can be purchased.
    pub is_active: bool,
}

/// A purchased policy instance.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Policy {
    /// Product this policy covers.
    pub product_id: u32,
    /// Policyholder Stellar address.
    pub holder: Address,
    /// Premium paid.
    pub premium_paid: i128,
    /// Coverage cap at payout.
    pub coverage_amount: i128,
    /// Ledger timestamp when policy was purchased.
    pub purchased_at: u64,
    /// Ledger timestamp when policy expires.
    pub expires_at: u64,
    /// Current lifecycle state.
    pub status: PolicyStatus,
    /// Oracle-reported value at the time of claim (set on successful claim).
    pub trigger_value: Option<i128>,
    /// Actual amount paid out (set on successful claim).
    pub payout_amount: Option<i128>,
}

/// Oracle data record submitted by authorised oracles.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OracleReading {
    /// The parameter being reported (must match Product.parameter_key).
    pub parameter_key: String,
    /// Reported value (scaled ×10^7).
    pub value: i128,
    /// Ledger timestamp of the reading.
    pub timestamp: u64,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProductCount,
    PolicyCount,
}

#[contracttype]
pub enum DataKey {
    Product(u32),
    Policy(u32),
    /// Latest oracle reading: (oracle_address, parameter_key) → OracleReading
    OracleReading(Address, String),
    /// Authorised oracle addresses.
    Oracle(Address),
}
