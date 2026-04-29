use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ContentNotFound = 4,
    ZeroAmount = 5,
    Paused = 6,
    AlreadySubscribed = 7,
    SubscriptionNotFound = 8,
    InvalidContent = 9,
    SelfTip = 10,
}

/// A published content item.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Content {
    pub id: u32,
    /// Author / publisher address.
    pub author: Address,
    /// Content title hash (sha256 of title stored off-chain).
    pub title_hash: String,
    /// Content body hash (sha256 of body stored off-chain / IPFS CID).
    pub content_hash: String,
    /// Total tips received in stroops.
    pub total_tips: i128,
    /// Number of tips received.
    pub tip_count: u32,
    /// Number of subscribers at time of publish.
    pub subscriber_count: u32,
    /// Timestamp of publication.
    pub published_at: u64,
    /// Whether the content is active (not removed).
    pub active: bool,
}

/// A subscriber record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Subscription {
    pub subscriber: Address,
    pub author: Address,
    /// Subscription start timestamp.
    pub subscribed_at: u64,
    pub active: bool,
}

/// Platform-level analytics snapshot.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PlatformStats {
    pub total_content: u32,
    pub total_tips: i128,
    pub total_subscriptions: u32,
}
