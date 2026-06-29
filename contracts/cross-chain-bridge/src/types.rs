// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, Bytes, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract already initialized.
    AlreadyInitialized = 1,
    /// Contract not yet initialized.
    NotInitialized = 2,
    /// Caller is not the admin.
    Unauthorized = 3,
    /// Lock amount must be greater than zero.
    ZeroAmount = 4,
    /// Deposit ID does not exist.
    DepositNotFound = 5,
    /// Deposit has already been processed (minted or refunded).
    AlreadyProcessed = 6,
    /// Deposit has not yet expired; cannot refund yet.
    NotExpired = 7,
    /// Provided ETH tx hash is empty.
    EmptyTxHash = 8,
    /// Destination ETH address is empty.
    EmptyDestination = 9,
    /// Token symbol must not be empty.
    EmptyToken = 10,
    /// Bridge is currently paused.
    BridgePaused = 11,
    /// Deposit has already expired; cannot mint.
    DepositExpired = 12,
    /// Relayer address is not registered.
    UnknownRelayer = 13,
    /// Daily bridge limit exceeded.
    DailyLimitExceeded = 14,
    /// Fee basis points out of range (max 1000 = 10%).
    InvalidFee = 15,
    /// Validator address is not registered.
    UnknownValidator = 16,
    /// Validator has already voted on this proof.
    AlreadyVoted = 17,
    /// Proof hash is empty.
    EmptyProofHash = 18,
    /// Quorum must be at least 1.
    InvalidQuorum = 19,
    /// Proof has not reached quorum; cannot confirm via validator path.
    ProofNotVerified = 20,
    /// Proof is already finalized (quorum reached).
    ProofAlreadyFinalized = 21,
}

/// Status of a bridge deposit.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum DepositStatus {
    /// Locked on Stellar, waiting for ETH confirmation.
    Pending = 0,
    /// Minted on Ethereum; bridge complete.
    Minted = 1,
    /// Refunded back to the depositor.
    Refunded = 2,
}

/// A single lock-and-mint bridge deposit.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Deposit {
    /// Stellar address that locked the tokens.
    pub depositor: Address,
    /// Token symbol (e.g. "USDC", "XLM").
    pub token: String,
    /// Amount locked (in stroops / smallest unit).
    pub amount: i128,
    /// Fee deducted at lock time (in stroops).
    pub fee: i128,
    /// Ethereum destination address (hex string).
    pub eth_destination: String,
    /// Ledger timestamp when the deposit was created.
    pub created_at: u64,
    /// Ledger timestamp after which a refund is allowed.
    pub expires_at: u64,
    /// Current status.
    pub status: DepositStatus,
    /// Ethereum transaction hash confirming the mint (set by relayer).
    pub eth_tx_hash: Option<Bytes>,
}

/// Aggregate bridge statistics.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BridgeStats {
    pub total_locked: i128,
    pub total_minted: i128,
    pub total_refunded: i128,
    pub deposit_count: u32,
    pub active_deposits: u32,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    DepositCount,
    IsPaused,
    FeeBps,
    ExpirySeconds,
    DailyLimit,
    DailyVolume,
    DailyVolumeTs,
}

/// Status of a cross-chain proof submitted by validators.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ProofStatus {
    /// Votes are being collected; quorum not yet reached.
    Pending = 0,
    /// Quorum reached; proof is verified and can trigger bridge actions.
    Verified = 1,
}

/// On-chain record of a validator quorum proof for a deposit.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ValidatorProof {
    /// The agreed-upon proof hash (first submitted hash wins; subsequent votes must match).
    pub proof_hash: Bytes,
    /// Number of validator votes received for this hash.
    pub vote_count: u32,
    /// Whether the proof has reached the required quorum.
    pub status: ProofStatus,
}

/// Instance-level storage keys for validator configuration.
#[contracttype]
pub enum ValidatorKey {
    /// Required number of validator votes to finalise a proof.
    Quorum,
    /// Total number of registered validators.
    ValidatorCount,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Deposit(u32),
    Relayer(Address),
    Stats,
    /// Whether an address is an active validator.
    Validator(Address),
    /// Quorum proof record for a deposit ID.
    Proof(u32),
    /// Whether a specific validator has already voted on a deposit proof.
    ValidatorVote(u32, Address),
}
