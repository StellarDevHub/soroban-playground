// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Product lifecycle ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProductStatus {
    Registered = 0,
    InTransit = 1,
    AtWarehouse = 2,
    QualityCheck = 3,
    Approved = 4,
    Rejected = 5,
    Delivered = 6,
    Recalled = 7,
}

// ── Quality check result ──────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum QualityResult {
    Pass = 0,
    Fail = 1,
    Pending = 2,
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Product {
    pub id: u32,
    pub owner: Address,
    pub name: String,
    /// SHA-256 hash of product metadata (origin, batch, etc.)
    pub metadata_hash: u64,
    pub status: ProductStatus,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Checkpoint {
    pub product_id: u32,
    pub index: u32,
    pub handler: Address,
    pub location_hash: u64,
    pub notes_hash: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct QualityReport {
    pub product_id: u32,
    pub inspector: Address,
    pub result: QualityResult,
    /// Hash of the detailed inspection report.
    pub report_hash: u64,
    pub timestamp: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProductCount,
    /// Whether the contract is paused (emergency stop).
    Paused,
}

#[contracttype]
pub enum DataKey {
    Product(u32),
    /// Number of checkpoints for a product.
    CheckpointCount(u32),
    Checkpoint(u32, u32),
    QualityReport(u32),
    /// Authorised inspector addresses.
    Inspector(Address),
    /// Authorised handler addresses.
    Handler(Address),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ProductNotFound = 4,
    InvalidStatus = 5,
    EmptyName = 6,
    NotInspector = 7,
    NotHandler = 8,
    AlreadyRecalled = 9,
    QualityReportNotFound = 10,
    ContractPaused = 11,
}
