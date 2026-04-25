// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

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
    /// Pool ID does not exist.
    PoolNotFound = 4,
    /// Route contains no hops.
    EmptyRoute = 5,
    /// Swap amount must be greater than zero.
    ZeroAmount = 6,
    /// Output is below the caller's minimum accepted amount.
    SlippageExceeded = 7,
    /// Pool name must not be empty.
    EmptyName = 8,
    /// Token symbol must not be empty.
    EmptyToken = 9,
    /// Pool is currently inactive.
    PoolInactive = 10,
    /// Route hop references an unknown pool.
    InvalidHop = 11,
    /// Route exceeds the maximum allowed hops.
    RouteTooLong = 12,
    /// Fee basis points out of range (max 1000 = 10%).
    InvalidFee = 13,
    /// Liquidity must be greater than zero.
    ZeroLiquidity = 14,
    /// No route found between the two tokens.
    NoRouteFound = 15,
    /// Price impact exceeds the pool's maximum.
    PriceImpactTooHigh = 16,
}

/// A single liquidity pool registered with the aggregator.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Pool {
    /// Human-readable name (e.g. "USDC/XLM AMM").
    pub name: String,
    /// Token A symbol.
    pub token_a: String,
    /// Token B symbol.
    pub token_b: String,
    /// Reserve of token A (in smallest unit).
    pub reserve_a: i128,
    /// Reserve of token B (in smallest unit).
    pub reserve_b: i128,
    /// Swap fee in basis points (e.g. 30 = 0.3%).
    pub fee_bps: u32,
    /// Whether the pool is accepting swaps.
    pub is_active: bool,
    /// Cumulative volume traded through this pool.
    pub total_volume: i128,
    /// Number of swaps executed.
    pub swap_count: u32,
}

/// One hop in a multi-hop swap route.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RouteHop {
    /// Pool ID to use for this hop.
    pub pool_id: u32,
    /// Input token for this hop.
    pub token_in: String,
    /// Output token for this hop.
    pub token_out: String,
}

/// A complete swap route (one or more hops).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Route {
    pub hops: Vec<RouteHop>,
    /// Estimated output amount for the route.
    pub estimated_out: i128,
    /// Aggregate fee cost in basis points.
    pub total_fee_bps: u32,
    /// Price impact in basis points.
    pub price_impact_bps: u32,
}

/// Result of executing a swap.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SwapResult {
    pub amount_in: i128,
    pub amount_out: i128,
    pub route: Route,
    pub executed_at: u64,
}

/// Aggregated price quote across all active pools for a token pair.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PriceQuote {
    pub pool_id: u32,
    pub token_in: String,
    pub token_out: String,
    pub amount_in: i128,
    pub amount_out: i128,
    pub fee_bps: u32,
    pub price_impact_bps: u32,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    PoolCount,
    MaxHops,
    ProtocolFeeBps,
    ProtocolFeeAccrued,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Pool(u32),
    UserVolume(Address),
}
