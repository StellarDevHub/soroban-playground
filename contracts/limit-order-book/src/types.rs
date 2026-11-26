// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, Vec};

/// Maximum number of matched fills allowed per transaction to guarantee
/// execution stays well within Soroban CPU instruction and storage budget limits.
pub const MAX_MATCHED_FILLS: u32 = 20;

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
#[derive(Clone, Debug, PartialEq)]
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

/// Linked-list node inside a bucketed price-level queue (`u32::MAX` = sentinel / null).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BucketNode {
    pub order_id: u64,
    pub remaining: i128,
    pub prev_idx: u32,
    pub next_idx: u32,
}

/// Bucketed price-level queue with linked-list order indices and links to
/// adjacent price levels (`0` = none).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PriceLevel {
    pub head_idx: u32,
    pub tail_idx: u32,
    pub prev_price: i128,
    pub next_price: i128,
    pub nodes: Vec<BucketNode>,
}

/// Summary of a match execution.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
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
    BestBid,
    BestAsk,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {

    Order(u64),
    OrderIndex(u64),
    PriceLevel(Side, i128),
    MatchedFills,



}
