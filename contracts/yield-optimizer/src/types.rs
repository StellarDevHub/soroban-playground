// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ProtocolNotFound = 4,
    VaultNotFound = 5,
    NoPosition = 6,
    InsufficientBalance = 7,
    VaultInactive = 8,
    InvalidApy = 9,
    EmptyName = 10,
    ZeroAmount = 11,
    ContractPaused = 12,
    BacktestNotFound = 13,
}

/// An external yield protocol (e.g. AMM, lending pool).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Protocol {
    pub name: String,
    /// Base APY in basis points.
    pub base_apy_bps: u32,
    pub is_active: bool,
}

/// An optimizer vault that routes deposits across one or more protocols.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Vault {
    pub name: String,
    /// Protocol this vault is currently allocated to.
    pub protocol_id: u32,
    /// Current effective APY in basis points (may differ from protocol base after rebalance).
    pub current_apy_bps: u32,
    /// Total value locked (stroops).
    pub total_deposited: i128,
    /// Accumulated rewards not yet compounded (stroops).
    pub pending_rewards: i128,
    /// Ledger timestamp of last compound.
    pub last_compound_ts: u64,
    /// Total rewards ever compounded (for analytics).
    pub total_compounded: i128,
    pub is_active: bool,
}

/// Per-user position in a vault.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Position {
    pub deposited: i128,
    /// Balance including compounded rewards.
    pub compounded_balance: i128,
    pub last_update_ts: u64,
}

/// A backtesting snapshot: records vault APY at a given timestamp.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct BacktestEntry {
    pub vault_id: u32,
    pub apy_bps: u32,
    pub tvl: i128,
    pub timestamp: u64,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProtocolCount,
    VaultCount,
    BacktestCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Protocol(u32),
    Vault(u32),
    Position(u32, Address),
    Backtest(u32),
}
