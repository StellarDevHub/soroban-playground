// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
pub enum DataKey {
    Admin,
    TotalSupply,
    TotalRetired,
    RetirementCount,
    IssuerInfo(Address),
    Balance(Address),
    Retirement(u32),
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct IssuerInfo {
    pub name: String,
    pub verified: bool,
    pub total_minted: i128,
}

/// Immutable on-chain record of a carbon credit retirement.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RetirementRecord {
    pub id: u32,
    pub retiree: Address,
    pub amount: i128,
    /// IPFS CID or project reference hash for the retirement reason.
    pub reason_hash: String,
    pub retired_at: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    IssuerAlreadyRegistered = 4,
    IssuerNotFound = 5,
    IssuerNotVerified = 6,
    InvalidAmount = 7,
    InsufficientBalance = 8,
    RetirementNotFound = 9,
}
