use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ZeroAmount = 4,
    InsufficientBalance = 5,
    InvalidWithdrawalPeriod = 6,
    NothingToUnstake = 7,
    RequestNotFound = 8,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct StakeInfo {
    pub amount: i128,
    pub shares: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UnstakeRequest {
    pub amount: i128,
    pub unlock_timestamp: u64,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    Initialized,
    Token,
    TotalStaked,
    TotalShares,
    UnstakePeriod,
}

#[contracttype]
pub enum DataKey {
    Stake(Address),
    Unstake(Address, u32),
    UnstakeCount(Address),
}
