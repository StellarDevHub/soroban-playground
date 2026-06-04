// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidBaseRate = 3,
    InvalidMultiplier = 4,
    InvalidMaxRate = 5,
    InvalidUtilization = 6,
    Unauthorized = 7,
    InvalidTier = 8,
    TooManyTiers = 9,
    InvalidTierThreshold = 10,
}

/// Interpolation method for interest rate curves.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CurveType {
    /// Linear: rate = base_rate + utilization * multiplier
    Linear,
    /// Exponential: rate grows faster at higher utilization
    Exponential,
}

/// Current pool utilization metrics: (borrowed, total_available)
#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolUtilization {
    pub borrowed: i128,
    pub total_available: i128,
}

/// Interest rate configuration parameters.
#[contracttype]
#[derive(Clone, Debug)]
pub struct InterestRateConfig {
    /// Base interest rate in basis points (e.g., 500 = 5.00%)
    pub base_rate_bps: u32,
    /// Multiplier applied to utilization (e.g., 10_000 = 100%)
    pub multiplier_bps: u32,
    /// Maximum interest rate cap in basis points
    pub max_rate_bps: u32,
    /// Curve type for rate calculation
    pub curve_type: CurveType,
}

/// A single interest rate tier for tiered rate models.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateTier {
    /// Utilization threshold (in basis points, 0-10000)
    pub threshold_bps: u32,
    /// Interest rate at this tier (in basis points)
    pub rate_bps: u32,
}

/// Historical rate snapshot for analytics.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateSnapshot {
    /// Timestamp of the snapshot
    pub timestamp: u64,
    /// Interest rate at this moment (in basis points)
    pub rate_bps: u32,
    /// Pool utilization at this moment (utilization_bps: 0-10000)
    pub utilization_bps: u32,
}

/// Query result for rate calculation.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RateQuery {
    /// Current interest rate (basis points)
    pub current_rate_bps: u32,
    /// Pool utilization percentage (basis points)
    pub utilization_bps: u32,
    /// Projected rate at target utilization
    pub projected_rate_bps: Option<u32>,
}

/// Storage key namespace.
#[contracttype]
pub enum DataKey {
    Admin,
    Initialized,
    Config,
    Tiers,
    TierCount,
    LastUpdate,
    HistoryIndex,
    HistorySnapshot(u32), // (snapshot_id)
}
