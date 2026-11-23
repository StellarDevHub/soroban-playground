// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NFTRecord {
    pub token_id: u64,
    pub owner: Address,
    pub user: Option<Address>,
    pub expires_at_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RentalListing {
    pub token_id: u64,
    pub owner: Address,
    pub price_per_ledger: i128,
    pub min_duration: u32,
    pub max_duration: u32,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRecord {
    pub token_id: u64,
    pub renter: Address,
    pub owner: Address,
    pub amount: i128,
    pub duration_ledgers: u32,
    pub is_active: bool,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    NFTNotFound = 4,
    NFTAlreadyExists = 5,
    ListingNotFound = 6,
    ListingNotActive = 7,
    EscrowNotFound = 8,
    InvalidDuration = 9,
    InvalidAmount = 10,
    InvalidExpirationLedger = 11,
    TokenCurrentlyLeased = 12,
    InsufficientPayment = 13,
    ActiveEscrow = 14,
}
