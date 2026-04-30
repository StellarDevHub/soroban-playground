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
    InvalidOutcome = 7,
    ZeroStake = 8,
    PositionNotFound = 9,
    Unauthorized = 10,
    ContractPaused = 11,
    InvalidOdds = 12,
    MarketCancelled = 13,
}

/// Sport category for the market
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Sport {
    Football,
    Basketball,
    Baseball,
    Soccer,
    Tennis,
    Other,
}

/// Possible outcomes for a sports market (Home / Draw / Away)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Outcome {
    Home,  // 0
    Draw,  // 1
    Away,  // 2
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MarketStatus {
    Open,
    Resolved,
    Cancelled,
}

/// A sports prediction market.
/// Odds are stored as basis points (e.g. 15000 = 1.50x, 20000 = 2.00x).
#[contracttype]
#[derive(Clone, Debug)]
pub struct SportMarket {
    pub id: u32,
    pub creator: Address,
    /// Human-readable description, e.g. "Lakers vs Celtics – 2026-05-01"
    pub description: String,
    pub sport: Sport,
    pub home_team: String,
    pub away_team: String,
    pub status: MarketStatus,
    pub resolution_deadline: u64,
    pub oracle: Address,
    pub winning_outcome: Option<u32>, // 0=Home, 1=Draw, 2=Away
    /// Odds in basis points for each outcome (home, draw, away)
    pub odds_home_bp: u32,
    pub odds_draw_bp: u32,
    pub odds_away_bp: u32,
    /// Total stakes per outcome
    pub total_home_stake: i128,
    pub total_draw_stake: i128,
    pub total_away_stake: i128,
    pub created_at: u64,
}

/// A bettor's position on a market outcome.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BetPosition {
    pub market_id: u32,
    pub bettor: Address,
    pub outcome: u32, // 0=Home, 1=Draw, 2=Away
    pub stake: i128,
    pub odds_bp: u32, // odds locked at bet time
    pub placed_at: u64,
}
