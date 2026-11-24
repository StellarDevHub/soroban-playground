// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, String};

/// Legacy ABI strategy variants; only Median is accepted for consensus.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AggregationStrategy {
    /// Median of all valid source prices.
    Median = 0,
    /// Weighted average using per-source weights.
    WeightedAverage = 1,
    /// Trimmed mean: drops lowest and highest price before averaging.
    TrimmedMean = 2,
}

/// A registered price source (oracle).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Source {
    pub id: u32,
    pub name: String,
    /// Relative weight used in WeightedAverage strategy (1–100).
    pub weight: u32,
    pub active: bool,
}

/// The most recent price submitted by a source for an asset.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceEntry {
    /// Price scaled to 18 decimal places (i.e. price * 10^18).
    pub price: i128,
    /// Ledger timestamp of the submission.
    pub timestamp: u64,
    pub source_id: u32,
}

/// Aggregated price result returned to callers.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct AggregatedPrice {
    pub asset: String,
    /// Aggregated price, scaled to 18 decimal places.
    pub price: i128,
    pub timestamp: u64,
    /// Number of sources that contributed.
    pub num_sources: u32,
    pub strategy: AggregationStrategy,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    SourceCount,
    Paused,
    Strategy,
    /// Maximum age (seconds) a price remains valid.
    MaxPriceAge,
    /// Outlier threshold in basis points (e.g. 2000 = 20%).
    OutlierBps,
    /// Circuit-breaker threshold in basis points (e.g. 5000 = 50%).
    CircuitBreakerBps,
    /// Minimum sources required for aggregation.
    MinSources,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Source(u32),
    /// Last price for (source_id, asset).
    Price(u32, String),
    /// Only authenticated rounds submitted after reporter binding.
    VerifiedPrice(u32, String),
    /// Whether source_id is authorized to submit prices.
    Authorized(u32),
    /// Circuit-breaker: last aggregated price for asset (for delta check).
    LastAggregated(String),
    PriceBounds(String),
    Reporter(u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    SourceNotFound = 4,
    SourceAlreadyExists = 5,
    InvalidWeight = 6,
    InvalidPrice = 7,
    InsufficientSources = 8,
    PriceStale = 9,
    ContractPaused = 10,
    CircuitBreakerTripped = 11,
    EmptyAsset = 12,
    MaxSourcesReached = 13,
    SourceInactive = 14,
    InvalidParameter = 15,
    PriceBoundsNotSet = 16,
    PriceOutOfBounds = 17,
    DuplicateReporter = 18,
    ReporterAlreadySet = 19,
}

/// Inclusive price limits in the asset's native price scale.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceBounds {
    pub min: i128,
    pub max: i128,
}
