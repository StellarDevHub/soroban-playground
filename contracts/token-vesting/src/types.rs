use soroban_sdk::{contracterror, contracttype, Address, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ScheduleNotFound = 3,
    CliffNotReached = 4,
    NothingToRelease = 5,
    Unauthorized = 6,
    InvalidSchedule = 7,
    MilestoneNotFound = 8,
    MilestoneAlreadyApproved = 9,
    AlreadyRevoked = 10,
    ScheduleRevoked = 11,
    ZeroAmount = 12,
}

/// Vesting schedule type
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VestingType {
    /// Linear: tokens unlock gradually after cliff
    Linear,
    /// Milestone: tokens unlock when admin approves each milestone
    Milestone,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub description_hash: u64, // hash of description to save storage
    pub pct_bps: u32,          // basis points (100 bps = 1%), total must sum to 10000
    pub approved: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VestingSchedule {
    pub id: u32,
    pub beneficiary: Address,
    pub token: Address,
    pub total_amount: i128,
    pub released_amount: i128,
    pub cliff_timestamp: u64,   // unix timestamp when cliff ends
    pub start_timestamp: u64,   // vesting start
    pub end_timestamp: u64,     // vesting end (linear only)
    pub vesting_type: VestingType,
    pub milestones: Vec<Milestone>,
    pub revoked: bool,
    pub created_at: u64,
}
