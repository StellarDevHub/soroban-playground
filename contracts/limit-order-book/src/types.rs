// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

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
    /// Order ID does not exist.
    OrderNotFound = 4,
    /// Amount must be greater than zero.
    ZeroAmount = 5,
    /// Price must be greater than zero.
    ZeroPrice = 6,
    /// Caller is not the order owner.
    NotOrderOwner = 7,
    /// Order is already filled or cancelled.
    OrderInactive = 8,
    /// Contract is paused.
    ContractPaused = 9,
    /// Order quantity exceeds available amount.
    InsufficientQuantity = 10,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Side {
    Buy,
    Sell,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum OrderStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
}

/// A limit order in the book.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u64,
    pub owner: Address,
    pub side: Side,
    /// Price in quote-token units per base-token unit (scaled by 1e7).
    pub price: i128,
    /// Original quantity in base-token units (scaled by 1e7).
    pub quantity: i128,
    /// Remaining unfilled quantity.
    pub remaining: i128,
    pub status: OrderStatus,
    /// Ledger sequence when the order was placed.
    pub created_at: u32,
}

/// Summary of a match execution.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Trade {
    pub buy_order_id: u64,
    pub sell_order_id: u64,
    pub price: i128,
    pub quantity: i128,
    pub executed_at: u32,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    OrderCount,
    Paused,
    TotalVolume,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Order(u64),
}
