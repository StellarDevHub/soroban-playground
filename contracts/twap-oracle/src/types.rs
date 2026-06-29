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
    UnknownFeeder = 4,
    AssetNotFound = 5,
    InsufficientObservations = 6,
    InvalidPrice = 7,
    InvalidWindow = 8,
    EmptyAssetId = 9,
    MaxObservationsExceeded = 10,
    OraclePaused = 11,
}

/// A single price observation recorded by a feeder.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Observation {
    /// Feeder that submitted the price.
    pub feeder: Address,
    /// Spot price at the time of submission (scaled by 10^7).
    pub price: i128,
    /// Ledger timestamp of this observation.
    pub timestamp: u64,
    /// Cumulative price × seconds up to this observation (for TWAP).
    pub cumulative_price: i128,
}

/// Computed TWAP result.
#[contracttype]
#[derive(Clone, Debug)]
pub struct TwapResult {
    /// The TWAP price over the requested window.
    pub price: i128,
    /// Start timestamp of the window used.
    pub window_start: u64,
    /// End timestamp of the window used.
    pub window_end: u64,
    /// Number of observations included.
    pub observation_count: u32,
}

/// Per-asset metadata stored in instance storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AssetConfig {
    /// Human-readable asset symbol.
    pub symbol: String,
    /// Maximum age (seconds) an observation is considered fresh.
    pub max_staleness: u64,
    /// Whether this asset's feed is active.
    pub is_active: bool,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    IsPaused,
    AssetCount,
}

#[contracttype]
pub enum DataKey {
    /// Active feeder whitelist.
    Feeder(Address),
    /// Per-asset config (keyed by asset_id u32).
    Asset(u32),
    /// Observation ring-buffer for an asset.
    Observations(u32),
    /// Asset symbol → asset_id lookup.
    AssetSymbol(String),
}
