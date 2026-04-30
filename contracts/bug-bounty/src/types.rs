// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Severity levels ───────────────────────────────────────────────────────────

/// Severity of a reported vulnerability.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Severity {
    /// Informational / low-impact finding.
    Low = 0,
    /// Medium-impact finding.
    Medium = 1,
    /// High-impact finding.
    High = 2,
    /// Critical / remote-code-execution class finding.
    Critical = 3,
}

// ── Report lifecycle ──────────────────────────────────────────────────────────

/// Lifecycle state of a vulnerability report.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ReportStatus {
    /// Submitted and awaiting triage.
    Pending = 0,
    /// Under review by the program admin.
    UnderReview = 1,
    /// Accepted; reward is claimable.
    Accepted = 2,
    /// Rejected (duplicate, out-of-scope, invalid).
    Rejected = 3,
    /// Reward has been paid out.
    Paid = 4,
    /// Report was withdrawn by the reporter.
    Withdrawn = 5,
}

// ── Structs ───────────────────────────────────────────────────────────────────

/// A vulnerability disclosure report.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    /// Auto-incremented report ID.
    pub id: u32,
    /// Address of the security researcher who submitted the report.
    pub reporter: Address,
    /// Short title of the vulnerability.
    pub title: String,
    /// Detailed description / proof-of-concept hash (e.g. IPFS CID).
    pub description_hash: String,
    /// Severity classification.
    pub severity: Severity,
    /// Current lifecycle status.
    pub status: ReportStatus,
    /// Reward amount in stroops (set when accepted).
    pub reward_amount: i128,
    /// Ledger timestamp when the report was submitted.
    pub submitted_at: u64,
    /// Ledger timestamp of the last status update.
    pub updated_at: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

/// Keys stored in instance storage (fast, small).
#[contracttype]
pub enum InstanceKey {
    /// Contract admin address.
    Admin,
    /// Total number of reports ever submitted.
    ReportCount,
    /// Whether the contract is paused.
    Paused,
    /// Total XLM (in stroops) deposited into the bounty pool.
    PoolBalance,
    /// Minimum reward per severity (Low).
    RewardLow,
    /// Minimum reward per severity (Medium).
    RewardMedium,
    /// Minimum reward per severity (High).
    RewardHigh,
    /// Minimum reward per severity (Critical).
    RewardCritical,
}

/// Keys stored in persistent storage (large, infrequent).
#[contracttype]
pub enum DataKey {
    /// A single report by ID.
    Report(u32),
    /// Whether `reporter` has an open (Pending/UnderReview) report: used to
    /// prevent spam submissions.
    HasOpenReport(Address),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ReportNotFound = 4,
    ContractPaused = 5,
    InvalidStatus = 6,
    InsufficientPool = 7,
    ZeroReward = 8,
    EmptyTitle = 9,
    EmptyDescriptionHash = 10,
    AlreadyHasOpenReport = 11,
    ReportAlreadyClosed = 12,
    NothingToClaim = 13,
}
