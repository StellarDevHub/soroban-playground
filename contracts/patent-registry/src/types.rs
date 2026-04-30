// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PatentNotFound = 4,
    LicenseNotFound = 5,
    DisputeNotFound = 6,
    AlreadyExists = 7,
    InvalidStatus = 8,
    EmptyField = 9,
    Paused = 10,
    NotOwner = 11,
    LicenseExpired = 12,
    DisputeAlreadyResolved = 13,
    InvalidFee = 14,
}

// ── Enums ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PatentStatus {
    Pending,
    Active,
    Expired,
    Revoked,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LicenseType {
    Exclusive,
    NonExclusive,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    Open,
    Resolved,
}

// ── Structs ───────────────────────────────────────────────────────────────────

/// A registered patent.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Patent {
    pub title: String,
    pub description: String,
    pub owner: Address,
    pub filing_date: u64,
    pub expiry_date: u64,
    pub status: PatentStatus,
    pub license_count: u32,
}

/// A license granted on a patent.
#[contracttype]
#[derive(Clone, Debug)]
pub struct License {
    pub patent_id: u32,
    pub licensee: Address,
    pub license_type: LicenseType,
    pub fee: i128,
    pub expiry_date: u64,
    pub granted_date: u64,
}

/// A dispute filed against a patent.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Dispute {
    pub patent_id: u32,
    pub claimant: Address,
    pub reason: String,
    pub filed_date: u64,
    pub status: DisputeStatus,
    pub resolution: String,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    PatentCount,
    LicenseCount,
    DisputeCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Patent(u32),
    License(u32),
    Dispute(u32),
}
