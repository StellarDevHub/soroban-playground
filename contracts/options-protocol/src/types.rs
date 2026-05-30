// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

/// Whether the option gives the right to buy or sell.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OptionKind {
    Call = 0,
    Put = 1,
}

/// Lifecycle state of an option contract.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OptionStatus {
    /// Written and available for exercise.
    Active = 0,
    /// Exercised by the holder.
    Exercised = 1,
    /// Expired without exercise.
    Expired = 2,
    /// Cancelled by the writer before expiry.
    Cancelled = 3,
}

/// A single on-chain option contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct OptionContract {
    /// Auto-incremented ID.
    pub id: u32,
    /// Address that wrote (sold) the option.
    pub writer: Address,
    /// Address that holds (bought) the option.
    pub holder: Address,
    /// Underlying asset symbol (e.g. "XLM").
    pub underlying: soroban_sdk::String,
    /// Strike price in stroops.
    pub strike_price: i128,
    /// Premium paid by holder to writer (in stroops).
    pub premium: i128,
    /// Notional amount of underlying (in stroops).
    pub amount: i128,
    /// Ledger timestamp after which the option expires.
    pub expiry: u64,
    /// Call or Put.
    pub kind: OptionKind,
    /// Current status.
    pub status: OptionStatus,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    OptionCount,
    Paused,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Option(u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    OptionNotFound = 4,
    OptionNotActive = 5,
    OptionExpired = 6,
    OptionNotExpired = 7,
    InvalidStrike = 8,
    InvalidPremium = 9,
    InvalidAmount = 10,
    InvalidExpiry = 11,
    ContractPaused = 12,
    WriterCannotBeHolder = 13,
}
