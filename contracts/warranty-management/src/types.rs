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
    WarrantyNotFound = 5,
    ClaimNotFound = 6,
    EmptyName = 7,
    InvalidDuration = 8,
    WarrantyExpired = 9,
    WarrantyInactive = 10,
    ClaimAlreadyProcessed = 11,
    NotWarrantyOwner = 12,
    ContractPaused = 13,
    ProductInactive = 14,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ClaimStatus {
    Pending = 0,
    Approved = 1,
    Rejected = 2,
}

/// A product registered by the manufacturer.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Product {
    pub manufacturer: Address,
    pub name: String,
    /// Warranty duration in seconds.
    pub warranty_duration_secs: u64,
    pub is_active: bool,
}

/// A warranty issued to a buyer for a specific product.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Warranty {
    pub product_id: u32,
    pub owner: Address,
    pub purchase_ts: u64,
    pub expiry_ts: u64,
    pub is_active: bool,
    pub serial_number: String,
}

/// A warranty claim filed by the owner.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub warranty_id: u32,
    pub claimant: Address,
    pub description: String,
    pub status: ClaimStatus,
    pub filed_ts: u64,
    pub resolved_ts: u64,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProductCount,
    WarrantyCount,
    ClaimCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Product(u32),
    Warranty(u32),
    Claim(u32),
}
