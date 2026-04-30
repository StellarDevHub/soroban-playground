use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    SongNotFound = 3,
    InvalidSplits = 4,
    Unauthorized = 5,
    InvalidAmount = 6,
    ZeroAmount = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Split {
    pub account: Address,
    pub share: u32, // In basis points (1/10000)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist: Address,
    pub splits: Vec<Split>,
    pub total_royalty_earned: i128,
}

/// Usage tracking for licensing
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UsageRecord {
    pub song_id: String,
    pub licensee: Address,
    pub usage_count: u32,
    pub total_paid: i128,
    pub last_payment_timestamp: u64,
}

/// License agreement
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct License {
    pub song_id: String,
    pub licensee: Address,
    pub license_type: String, // "streaming", "commercial", "sync"
    pub royalty_rate: u32,    // basis points
    pub active: bool,
    pub created_at: u64,
    pub expires_at: u64,
}

/// Revenue sharing configuration
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RevenueShare {
    pub song_id: String,
    pub total_revenue: i128,
    pub distributed_revenue: i128,
    pub pending_distribution: i128,
    pub last_distribution_timestamp: u64,
}
