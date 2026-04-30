// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

// ── Curve type ────────────────────────────────────────────────────────────────

/// Bonding curve used to price NFTs in a pool.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum CurveType {
    /// Price stays constant regardless of supply.
    Linear = 0,
    /// Price multiplies by a fixed factor on each trade.
    Exponential = 1,
}

// ── Pool type ─────────────────────────────────────────────────────────────────

/// Whether the pool buys NFTs, sells NFTs, or does both (trade pool).
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PoolType {
    /// Only buys NFTs from users (token → NFT).
    Buy = 0,
    /// Only sells NFTs to users (NFT → token).
    Sell = 1,
    /// Two-sided: buys and sells, earns the spread as fee.
    Trade = 2,
}

// ── Structs ───────────────────────────────────────────────────────────────────

/// An NFT liquidity pool for a single collection.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Pool {
    /// Unique pool ID.
    pub id: u32,
    /// Pool creator / owner.
    pub owner: Address,
    /// NFT collection contract address.
    pub nft_collection: Address,
    /// Payment token contract address (e.g. XLM).
    pub payment_token: Address,
    /// Bonding curve type.
    pub curve: CurveType,
    /// Pool type (buy / sell / trade).
    pub pool_type: PoolType,
    /// Current spot price in payment token units (stroops).
    pub spot_price: i128,
    /// Delta: linear step (stroops) or exponential multiplier (bps, e.g. 500 = 5%).
    pub delta: i128,
    /// Fee charged on each trade in basis points (e.g. 100 = 1%).
    pub fee_bps: i128,
    /// Number of NFTs currently held by the pool.
    pub nft_count: u32,
    /// Payment token balance held by the pool.
    pub token_balance: i128,
    /// Total volume traded through this pool (in payment token units).
    pub total_volume: i128,
    /// Total number of trades executed.
    pub trade_count: u32,
    /// Whether the pool is active.
    pub active: bool,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    PoolCount,
    Paused,
    /// Protocol fee in basis points (taken from pool fee).
    ProtocolFeeBps,
    /// Accumulated protocol fees.
    ProtocolFeeBalance,
}

#[contracttype]
pub enum DataKey {
    Pool(u32),
    /// NFT IDs held by pool: (pool_id, slot_index) → nft_id
    PoolNft(u32, u32),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PoolNotFound = 4,
    PoolNotActive = 5,
    ContractPaused = 6,
    InsufficientNfts = 7,
    InsufficientTokens = 8,
    ZeroAmount = 9,
    InvalidDelta = 10,
    InvalidFee = 11,
    InvalidSpotPrice = 12,
    WrongPoolType = 13,
    Overflow = 14,
    NftNotInPool = 15,
}
