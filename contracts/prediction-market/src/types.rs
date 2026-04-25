use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    MarketNotFound = 3,
    MarketAlreadyResolved = 4,
    MarketNotResolved = 5,
    MarketExpired = 6,
    MarketNotExpired = 7,
    InvalidOutcome = 8,
    InsufficientStake = 9,
    NothingToWithdraw = 10,
    Unauthorized = 11,
    InvalidMarketType = 12,
    ZeroStake = 13,
    PositionNotFound = 14,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MarketType {
    Binary,  // YES/NO outcome
    Scalar,  // Numeric range outcome
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MarketStatus {
    Open,
    Resolved,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Market {
    pub id: u32,
    pub creator: Address,
    pub question: String,
    pub market_type: MarketType,
    pub status: MarketStatus,
    pub resolution_deadline: u64, // ledger timestamp
    pub oracle: Address,
    pub winning_outcome: Option<u32>, // 0=NO/low, 1=YES/high for binary; numeric for scalar
    pub total_yes_stake: i128,
    pub total_no_stake: i128,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Position {
    pub market_id: u32,
    pub trader: Address,
    pub outcome: u32, // 1=YES, 0=NO
    pub stake: i128,
}
