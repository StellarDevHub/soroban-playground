// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String, BytesN};

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
    EscrowNotFound = 15,
    MilestoneNotFound = 16,
    InvalidMilestoneStatus = 17,
    InsufficientDeposit = 18,
    EscrowAlreadyReleased = 19,
    EscrowAlreadyRefunded = 20,
    MilestoneAlreadyCompleted = 21,
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

/// Status of an escrow milestone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,
    Completed,
    Verified,
    Rejected,
}

/// Status of the escrow itself.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Funded,
    PartiallyReleased,
    FullyReleased,
    Refunded,
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
    pub doc_hash: BytesN<32>,
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

/// A milestone within an escrow agreement.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u32,
    pub escrow_id: u32,
    pub description: String,
    pub amount: i128,
    pub status: MilestoneStatus,
    pub due_date: u64,
    pub completed_at: Option<u64>,
    pub verified_at: Option<u64>,
}

/// An escrow agreement for patent licensing with milestone-based releases.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u32,
    pub patent_id: u32,
    pub license_id: u32,
    pub payer: Address,
    pub payee: Address,
    pub total_amount: i128,
    pub deposited_amount: i128,
    pub released_amount: i128,
    pub status: EscrowStatus,
    pub created_at: u64,
    pub milestone_count: u32,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    PatentCount,
    LicenseCount,
    DisputeCount,
    EscrowCount,
    MilestoneCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Patent(u32),
    License(u32),
    Dispute(u32),
    Escrow(u32),
    Milestone(u32),
    PatentHash(BytesN<32>),
}
