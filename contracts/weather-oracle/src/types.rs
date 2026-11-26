// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

/// Verification status of a weather data record.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum WeatherDataStatus {
    Pending = 0,
    Verified = 1,
    Disputed = 2,
}

/// A single weather data record aggregated from multiple sources.
#[contracttype]
#[derive(Clone, Debug)]
pub struct WeatherData {
    /// Unique record ID
    pub id: u32,
    /// Location identifier (e.g. city name or lat/lon string)
    pub location: String,
    /// Temperature in Celsius × 100 (fixed-point, avoids floats)
    pub temperature_c: i32,
    /// Humidity percentage × 100
    pub humidity_pct: i32,
    /// Wind speed km/h × 100
    pub wind_speed_kmh: i32,
    /// Unix timestamp of the observation
    pub observed_at: u64,
    /// Unix timestamp when first submitted on-chain
    pub submitted_at: u64,
    /// Number of sources that confirmed this record
    pub confirmations: u32,
    pub status: WeatherDataStatus,
}

/// A registered data source (satellite feed, ground station, weather API).
#[contracttype]
#[derive(Clone, Debug)]
pub struct DataSource {
    pub address: Address,
    pub name: String,
    pub active: bool,
    /// Total submissions from this source
    pub submissions: u32,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    Initialized,
    Paused,
    /// Minimum confirmations before data is Verified
    VerificationThreshold,
    /// Running counter for WeatherData IDs
    RecordCount,
    /// Whether the circuit breaker is active
    CircuitBreaker,
    /// Number of registered sources
    SourceCount,
}

#[contracttype]
pub enum DataKey {
    /// WeatherData(id)
    WeatherData(u32),
    /// DataSource keyed by address
    Source(Address),
    /// Submission flag: (record_id, source_address)
    Submitted(u32, Address),
    /// Historical index: (location, observed_at) → record_id
    HistoryIndex(String, u64),
    /// Epoch weather reports: (station_id, epoch) -> Vec<EpochReport>
    EpochReports(u32, u64),
    /// Finalized epoch consensus benchmark: (station_id, epoch) -> EpochConsensus
    EpochConsensus(u32, u64),
}

/// Weather report for an epoch submitted by a station/source.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EpochReport {
    pub reporter: Address,
    pub station_id: u32,
    pub rainfall_mm: u32,
    pub observed_at: u64,
}

/// Consensus benchmark for a measurement epoch calculated using IQR trimming.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct EpochConsensus {
    pub station_id: u32,
    pub epoch: u64,
    pub total_reports: u32,
    pub valid_reports: u32,
    pub trimmed_median_rainfall: u32,
    pub finalized_at: u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    CircuitBreakerActive = 5,
    SourceAlreadyExists = 6,
    SourceNotFound = 7,
    SourceInactive = 8,
    RecordNotFound = 9,
    AlreadySubmitted = 10,
    InvalidThreshold = 11,
    InvalidTemperature = 12,
    InvalidHumidity = 13,
    InvalidWindSpeed = 14,
    EmptyLocation = 15,
    InvalidTimestamp = 16,
    StaleData = 17,
    ConsensusNotReached = 18,
    OutlierFiltered = 19,
    InsufficientReports = 20,
}
