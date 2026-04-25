// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

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
    /// Deposit amount must be greater than zero.
    ZeroAmount = 4,
    /// Strategy ID does not exist.
    StrategyNotFound = 5,
    /// User has no position in this strategy.
    NoPosition = 6,
    /// Withdrawal amount exceeds deposited balance.
    InsufficientBalance = 7,
    /// Strategy is currently paused.
    StrategyPaused = 8,
    /// APY value out of acceptable range (max 10000 bps = 100%).
    InvalidApy = 9,
    /// Strategy name must not be empty.
    EmptyName = 10,
}

/// Represents a single yield strategy (e.g. a liquidity pool or lending vault).
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Strategy {
    /// Human-readable name.
    pub name: String,
    /// Annual percentage yield in basis points (1 bps = 0.01%).
    pub apy_bps: u32,
    /// Total value locked across all depositors (in stroops / smallest unit).
    pub total_deposited: i128,
    /// Whether the strategy is accepting new deposits.
    pub is_active: bool,
    /// Accumulated rewards available for compounding (in stroops).
    pub pending_rewards: i128,
    /// Ledger timestamp of the last compound operation.
    pub last_compound_ts: u64,
}

/// Tracks an individual user's position in a strategy.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Position {
    /// Amount the user originally deposited.
    pub deposited: i128,
    /// Compounded balance (deposited + reinvested rewards).
    pub compounded_balance: i128,
    /// Ledger timestamp of the user's last deposit or compound.
    pub last_update_ts: u64,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    StrategyCount,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    /// Strategy data by numeric ID.
    Strategy(u32),
    /// User position: (strategy_id, user_address).
    Position(u32, Address),
}
