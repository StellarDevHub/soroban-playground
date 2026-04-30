// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    TokenA,
    TokenB,
    ReserveA,
    ReserveB,
    TotalLp,
    /// Cumulative price accumulator for TWAP: price_a_cumulative
    PriceACum,
    /// Cumulative price accumulator for TWAP: price_b_cumulative
    PriceBCum,
    /// Ledger timestamp of last swap (for TWAP)
    LastTimestamp,
    /// Swap fee in basis points (default 30 = 0.30%)
    FeeBps,
    /// NFT collection address (for NFT AMM pools)
    NftCollection,
    /// Total volume traded in the pool
    TotalVolume,
    /// Total fees collected
    TotalFees,
}

#[contracttype]
pub enum DataKey {
    /// LP balance for an address.
    Lp(Address),
    /// NFT floor price tracking
    NftFloorPrice,
    /// Collection statistics
    CollectionStats,
}

/// NFT Collection Analytics
#[contracttype]
#[derive(Clone, Debug)]
pub struct CollectionStats {
    pub floor_price: i128,
    pub ceiling_price: i128,
    pub total_volume: i128,
    pub trade_count: u32,
    pub unique_holders: u32,
    pub last_update: u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ZeroAmount = 4,
    InsufficientLiquidity = 5,
    SlippageExceeded = 6,
    InsufficientLpBalance = 7,
    InvalidToken = 8,
    Overflow = 9,
    ZeroOutput = 10,
}
