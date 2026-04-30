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

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Deposit(u32),
    Relayer(Address),
    Stats,
}
