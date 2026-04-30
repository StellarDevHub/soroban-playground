use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ZeroAmount = 4,
    StrategyNotFound = 5,
    NoPosition = 6,
    InsufficientBalance = 7,
    StrategyPaused = 8,
    InvalidApy = 9,
    EmptyName = 10,
    InvalidFee = 11,
    InvalidInterval = 12,
    ContractPaused = 13,
    CompoundTooSoon = 14,
    InvalidProtocol = 15,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Strategy {
    pub name: String,
    pub protocol: String,
    pub apy_bps: u32,
    pub fee_bps: u32,
    pub total_deposited: i128,
    pub total_shares: i128,
    pub is_active: bool,
    pub compound_interval: u64,
    pub last_compound_ts: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Position {
    pub shares: i128,
    pub principal: i128,
    pub last_action_ts: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PositionView {
    pub shares: i128,
    pub principal: i128,
    pub current_balance: i128,
    pub last_action_ts: u64,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    Executor,
    StrategyCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Strategy(u32),
    Position(u32, Address),
}
