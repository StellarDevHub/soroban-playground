// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AlreadyInState = 4,
    ContractPaused = 5,
    InsufficientSignatures = 6,
    ProposalNotFound = 7,
    ProposalAlreadyExecuted = 8,
    ProposalExpired = 9,
    GuardianAlreadyAdded = 10,
    GuardianNotFound = 11,
    TimeLockNotExpired = 12,
    InvalidThreshold = 13,
    AlreadyExists = 14,
    AlreadySigned = 15,
    NoPendingUnpause = 16,
    EmergencyWithdrawNotAllowed = 17,
    InsufficientBalance = 18,
    AdminAlreadyAdded = 19,
    AdminNotFound = 20,
    DuplicateSigner = 21,
    InvalidAmount = 22,
    TokenNotSet = 23,
    Overflow = 24,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admins,
    AdminThreshold,
    Guardians,
    Paused,
    PauseReason,
    PauseTimestamp,
    UnpauseEta,
    Token,
}

#[contracttype]
pub enum DataKey {
    Balance(Address),
}
