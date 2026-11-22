// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, BytesN, String};

#[contracttype]
pub enum DataKey {
    Admin,
    TotalSupply,
    TotalRetired,
    RetirementCount,
    IssuerInfo(Address),
    Balance(Address),
    Retirement(u32),
    /// Registry validation oracle allow-list.
    Oracle(Address),
    /// Non-transferable retirement certificate, keyed by certificate ID.
    Certificate(u32),
    /// Uniqueness index: serial-range fingerprint -> certificate ID.
    CertificateByFingerprint(BytesN<32>),
    /// Uniqueness index: certificate hash -> certificate ID.
    CertificateByHash(BytesN<32>),
    /// Highest serial number consumed for a (registry, project, vintage) key.
    SerialCursor(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuerInfo {
    pub name: String,
    pub verified: bool,
    pub total_minted: i128,
}

/// Immutable on-chain record of a carbon credit retirement.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetirementRecord {
    pub id: u32,
    pub retiree: Address,
    pub amount: i128,
    /// IPFS CID or project reference hash for the retirement reason.
    pub reason_hash: String,
    pub retired_at: u64,
}

/// A non-transferable certificate of retirement.
///
/// Binds the retired amount to a specific registry project and vintage serial
/// range, and records the registry validation oracle that authorised it.
/// Certificates have no transfer entry point: once minted they are permanently
/// bound to `retiree` and can only be read.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RetirementCertificate {
    pub cert_id: u32,
    /// Registry identifier, e.g. "Verra" or "GoldStandard".
    pub registry: String,
    /// Registry project identifier, e.g. "VCS-1234".
    pub project_id: String,
    /// Vintage year of the underlying credits.
    pub vintage: u32,
    /// Inclusive serial range retired: `serial_start..=serial_end`.
    pub serial_start: u64,
    pub serial_end: u64,
    pub amount: i128,
    /// Holder whose credits were burned. Certificates are non-transferable.
    pub retiree: Address,
    /// Registry validation oracle that signed off on the serial range.
    pub oracle: Address,
    /// Deterministic hash over all certificate fields.
    pub cert_hash: BytesN<32>,
    pub retired_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    IssuerAlreadyRegistered = 4,
    IssuerNotFound = 5,
    IssuerNotVerified = 6,
    InvalidAmount = 7,
    InsufficientBalance = 8,
    RetirementNotFound = 9,
    IssuerAlreadyVerified = 10,
    InvalidRecipient = 11,
    InvalidReasonHash = 12,
    OracleAlreadyRegistered = 13,
    OracleNotFound = 14,
    InvalidSerialRange = 15,
    SerialRangeAlreadyRetired = 16,
    CertificateNotFound = 17,
    InvalidRegistry = 18,
    InvalidProjectId = 19,
    InvalidVintage = 20,
}
