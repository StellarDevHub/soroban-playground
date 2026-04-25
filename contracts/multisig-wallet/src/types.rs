// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Roles ─────────────────────────────────────────────────────────────────────

/// Role hierarchy: OWNER > ADMIN > OPERATOR > VIEWER
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Role {
    Viewer = 0,
    Operator = 1,
    Admin = 2,
    Owner = 3,
}

// ── Transaction status ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TxStatus {
    /// Collecting approvals.
    Pending = 0,
    /// Threshold reached; waiting for timelock to expire.
    Queued = 1,
    /// Executed successfully.
    Executed = 2,
    /// Cancelled before execution.
    Cancelled = 3,
    /// Expired without reaching threshold.
    Expired = 4,
}

// ── Structs ───────────────────────────────────────────────────────────────────

/// A signer entry stored in the wallet.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Signer {
    pub address: Address,
    pub role: Role,
}

/// A pending / historical transaction proposal.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Transaction {
    pub id: u32,
    pub proposer: Address,
    /// Human-readable description / calldata summary.
    pub description: String,
    /// XLM amount in stroops (0 for non-transfer proposals).
    pub amount: i128,
    /// Optional recipient for XLM transfers.
    pub recipient: Option<Address>,
    pub status: TxStatus,
    /// Number of approvals collected.
    pub approvals: u32,
    /// Ledger timestamp when the proposal was created.
    pub created_at: u64,
    /// Ledger timestamp after which the tx can be executed (timelock).
    pub execute_after: u64,
    /// Ledger timestamp after which the proposal expires.
    pub expires_at: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    Threshold,
    SignerCount,
    TxCount,
    /// Daily withdrawal limit in stroops.
    DailyLimit,
    /// Stroops withdrawn today.
    WithdrawnToday,
    /// Ledger timestamp of the current withdrawal day start.
    DayStart,
}

#[contracttype]
pub enum DataKey {
    Signer(Address),
    Transaction(u32),
    /// Whether `signer` has approved tx `id`: (tx_id, signer).
    Approval(u32, Address),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    SignerNotFound = 4,
    SignerAlreadyExists = 5,
    TransactionNotFound = 6,
    InvalidThreshold = 7,
    AlreadyApproved = 8,
    TimelockActive = 9,
    TransactionNotQueued = 10,
    TransactionExpired = 11,
    TransactionNotPending = 12,
    DailyLimitExceeded = 13,
    InsufficientBalance = 14,
    EmptyDescription = 15,
}
