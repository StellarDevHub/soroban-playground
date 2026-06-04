// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracttype, BytesN, String};

/// Severity level for a security finding.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SeverityLevel {
    None = 0,
    Info = 1,
    Low = 2,
    Medium = 3,
    High = 4,
    Critical = 5,
}

/// Result of a security vulnerability scan.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct SecurityReport {
    /// Unique scan ID (monotonic counter).
    pub id: u32,
    /// WASM hash of the analysed contract.
    pub contract_hash: BytesN<32>,
    /// Worst-case severity found.
    pub severity: SeverityLevel,
    /// Number of individual findings.
    pub finding_count: u32,
    /// Ledger timestamp of the scan.
    pub scanned_at: u64,
}

/// Result of a gas-usage analysis.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct GasReport {
    pub id: u32,
    pub contract_hash: BytesN<32>,
    /// Estimated average gas units per call.
    pub avg_gas: u64,
    /// Estimated worst-case gas units.
    pub max_gas: u64,
    /// Optimisation score 0-100 (100 = fully optimised).
    pub optimisation_score: u32,
    pub analysed_at: u64,
}

/// Result of a code-quality check.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct QualityReport {
    pub id: u32,
    pub contract_hash: BytesN<32>,
    /// Overall quality score 0-100.
    pub score: u32,
    /// Number of style / best-practice warnings.
    pub warning_count: u32,
    pub checked_at: u64,
}

/// Result of a formal-property verification.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VerificationResult {
    pub id: u32,
    pub contract_hash: BytesN<32>,
    /// Human-readable property being verified.
    pub property: String,
    /// Whether the property holds.
    pub holds: bool,
    pub verified_at: u64,
}

/// Instance-storage singleton keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    SecurityCount,
    GasCount,
    QualityCount,
    VerifyCount,
}

/// Persistent per-report storage keys.
#[contracttype]
pub enum DataKey {
    Security(u32),
    Gas(u32),
    Quality(u32),
    Verify(u32),
}

