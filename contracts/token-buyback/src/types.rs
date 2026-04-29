use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidConfig = 4,
    ZeroAmount = 5,
    InsufficientTreasury = 6,
    TooEarly = 7,
    Paused = 8,
    RecordNotFound = 9,
}

/// Buyback program configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BuybackConfig {
    /// Token address to buy back and burn.
    pub token_address: Address,
    /// Percentage of treasury to use per buyback in basis points (e.g. 500 = 5%).
    pub buyback_bps: u32,
    /// Minimum buyback amount per execution.
    pub min_buyback_amount: i128,
    /// Maximum buyback amount per execution.
    pub max_buyback_amount: i128,
    /// Minimum seconds between buybacks.
    pub frequency_seconds: u64,
    /// Whether the program is paused.
    pub paused: bool,
}

/// Aggregate statistics for the buyback program.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BuybackStats {
    /// Total tokens purchased across all buybacks.
    pub total_purchased: i128,
    /// Total tokens burned across all buybacks.
    pub total_burned: i128,
    /// Total revenue (in payment token) used for buybacks.
    pub total_revenue_used: i128,
    /// Number of buyback executions.
    pub buyback_count: u32,
    /// Timestamp of the last buyback.
    pub last_buyback_timestamp: u64,
}

/// Record of a single market purchase.
#[contracttype]
#[derive(Clone, Debug)]
pub struct PurchaseRecord {
    pub id: u32,
    /// Amount of payment token spent.
    pub amount_spent: i128,
    /// Amount of buyback tokens received.
    pub tokens_received: i128,
    pub timestamp: u64,
    pub executor: Address,
}

/// Record of a token burn event.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BurnRecord {
    pub id: u32,
    /// Tokens burned in this event.
    pub tokens_burned: i128,
    /// Corresponding purchase record ID.
    pub purchase_id: u32,
    pub timestamp: u64,
}
