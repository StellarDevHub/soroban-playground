use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

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
    InvalidOutcome = 7,
    ZeroStake = 8,
    PositionNotFound = 9,
    Paused = 10,
    Unauthorized = 11,
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
pub struct Outcome {
    pub name: String,
    pub total_stake: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SportMarket {
    pub id: u32,
    pub creator: Address,
    pub event_name: String,
    pub outcomes: Vec<Outcome>,
    pub status: MarketStatus,
    pub resolution_deadline: u64,
    pub oracle: Address,
    pub winning_outcome_index: Option<u32>,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Bet {
    pub market_id: u32,
    pub bettor: Address,
    pub outcome_index: u32,
    pub stake: i128,
}
