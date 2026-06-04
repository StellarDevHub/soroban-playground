// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

/// Aggregation strategy used when combining multiple source prices.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AggregationStrategy {
    /// Middle value of sorted prices (robust against outliers)
    Median = 0,
    /// Sum of (price * weight) / sum of weights
    WeightedAverage = 1,
    /// Average after dropping the top and bottom `trim_pct` % of sources
    TrimmedMean = 2,
}

/// A single price source (oracle / data provider).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceSource {
    /// On-chain address that is authorised to update this source's price
    pub reporter: Address,
    /// Human-readable label (max 32 bytes recommended)
    pub description: soroban_sdk::String,
    /// Weight used in WeightedAverage (1–100, default 1)
    pub weight: u32,
    /// Most recently reported price (scaled by `decimals`, e.g. price * 10^7)
    pub last_price: i128,
    /// Ledger timestamp of the last price update
    pub last_updated: u64,
    /// Whether this source is currently active
    pub active: bool,
}

/// Aggregated price result returned by `get_aggregated_price`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AggregatedPrice {
    /// Aggregated price value
    pub price: i128,
    /// Number of sources that contributed
    pub num_sources: u32,
    /// Ledger timestamp of this aggregation
    pub timestamp: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    Paused,
    /// Monotonically increasing source counter (also total ever added)
    SourceCount,
    /// Number of decimal places prices are scaled by (e.g. 7 → multiply by 1e7)
    Decimals,
    /// Maximum age (seconds) a price can be before it is considered stale
    MaxPriceAge,
    /// Outlier detection threshold in basis points (e.g. 1000 = 10%)
    OutlierBps,
    /// Aggregation strategy
    Strategy,
    /// Trim percentage for TrimmedMean (1–49)
    TrimPct,
    /// Circuit-breaker: max single-update deviation in bps
    CircuitBreakerBps,
    /// Asset symbol this feed tracks (e.g. "XLM/USD")
    Asset,
}

#[contracttype]
pub enum DataKey {
    Source(u32),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    SourceNotFound = 4,
    SourceInactive = 5,
    InvalidPrice = 6,
    StalePrice = 7,
    InsufficientSources = 8,
    ContractPaused = 9,
    InvalidWeight = 10,
    OutlierDetected = 11,
    CircuitBreakerTripped = 12,
    InvalidParameter = 13,
}
