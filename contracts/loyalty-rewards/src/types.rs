// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

/// Merchant registered in the loyalty network.
#[contracttype]
#[derive(Clone)]
pub struct Merchant {
    pub id: u32,
    pub owner: Address,
    pub name: String,
    pub active: bool,
    pub total_issued: i128,
    pub registered_at: u64,
}

/// A single points-earn transaction.
#[contracttype]
#[derive(Clone)]
pub struct EarnRecord {
    pub user: Address,
    pub merchant_id: u32,
    pub points: i128,
    pub timestamp: u64,
}

/// A single redemption transaction.
#[contracttype]
#[derive(Clone)]
pub struct RedeemRecord {
    pub user: Address,
    pub merchant_id: u32,
    pub points: i128,
    pub timestamp: u64,
}

/// Per-user analytics snapshot.
#[contracttype]
#[derive(Clone)]
pub struct UserStats {
    pub total_earned: i128,
    pub total_redeemed: i128,
    pub last_activity: u64,
}

#[contracterror]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    MerchantNotFound = 4,
    MerchantInactive = 5,
    InsufficientPoints = 6,
    InvalidAmount = 7,
    Paused = 8,
    MerchantAlreadyExists = 9,
}
