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
    EmptyField = 7,
    WarrantyExpired = 8,
    WarrantyInactive = 9,
    ClaimAlreadyProcessed = 10,
    ContractPaused = 11,
    InvalidDuration = 12,
}

/// A registered product eligible for warranty coverage.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Product {
    pub name: String,
    /// Manufacturer / brand address.
    pub manufacturer: Address,
    /// Default warranty duration in seconds.
    pub default_warranty_secs: u64,
    pub is_active: bool,
}

/// A warranty issued to an owner for a specific product.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Warranty {
    pub product_id: u32,
    pub owner: Address,
    /// Ledger timestamp when warranty was issued.
    pub issued_at: u64,
    /// Ledger timestamp when warranty expires.
    pub expires_at: u64,
    pub is_active: bool,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ClaimStatus {
    Pending = 0,
    Approved = 1,
    Rejected = 2,
}

/// A warranty claim filed by an owner.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub warranty_id: u32,
    pub claimant: Address,
    pub description: String,
    pub filed_at: u64,
    pub status: ClaimStatus,
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
