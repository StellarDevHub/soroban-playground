// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Transaction status ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TxStatus {
    /// Collecting confirmations.
    Pending = 0,
    /// Threshold reached, waiting for delay to elapse.
    Ready = 1,
    /// Executed.
    Executed = 2,
    /// Cancelled before execution.
    Cancelled = 3,
}

// ── Structs ───────────────────────────────────────────────────────────────────

/// A queued / historical transaction.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Transaction {
    pub id: u32,
    pub proposer: Address,
    /// Recipient or callee for the operation.
    pub target: Address,
    /// Native value (e.g. XLM in stroops) for the operation.
    pub value: i128,
    /// Free-form calldata / description.
    pub data: String,
    pub status: TxStatus,
    /// Number of confirmations collected.
    pub confirmations: u32,
    /// Sum of confirmer weights (see owner weights). A transaction becomes
    /// `Ready` once this reaches the threshold.
    pub confirmation_weight: u64,
    /// Ledger timestamp when the proposal was created.
    pub created_at: u64,
    /// Required delay (seconds) between threshold met and executable.
    pub delay: u64,
    /// Ledger timestamp after which the transaction can be executed.
    /// Zero until the threshold is met.
    pub execute_after: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Initialized,
    Threshold,
    MinDelay,
    MaxDelay,
    OwnerCount,
    TxCount,
}

#[contracttype]
pub enum DataKey {
    /// Owner at index `u32` (kept dense: index = position in owner list).
    OwnerAt(u32),
    /// Marks `Address` as a current owner.
    IsOwner(Address),
    /// Transaction by id.
    Transaction(u32),
    /// Whether `owner` has confirmed `tx_id`.
    Confirmation(u32, Address),
    /// Voting weight of an owner (default 1 when absent).
    OwnerWeight(Address),
    /// Registered ed25519 public key of an owner for off-chain signatures.
    OwnerPubkey(Address),
    /// Per-owner monotonic nonce consumed by off-chain signature confirms.
    OwnerNonce(Address),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    OwnerRequired = 4,
    OwnerExists = 5,
    OwnerNotFound = 6,
    DuplicateOwner = 7,
    SelfRemoval = 8,
    InvalidThreshold = 9,
    InvalidDelay = 10,
    InvalidValue = 11,
    EmptyData = 12,
    DataTooLong = 13,
    TransactionNotFound = 14,
    AlreadyConfirmed = 15,
    NotConfirmed = 16,
    WrongStatus = 17,
    DelayNotElapsed = 18,
    /// Owner weight must be at least 1.
    InvalidWeight = 19,
    /// Owner has no registered ed25519 public key.
    MissingPubkey = 20,
    /// Signature nonce does not match the owner's current nonce.
    InvalidNonce = 21,
}
