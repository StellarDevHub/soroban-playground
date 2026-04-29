use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    NotPaused = 5,
    AirdropNotFound = 6,
    AirdropExpired = 7,
    AirdropNotStarted = 8,
    AirdropEnded = 9,
    AlreadyClaimed = 10,
    NotEligible = 11,
    InsufficientFunds = 12,
    ZeroAmount = 13,
    InvalidTimestamp = 14,
    EmptyRecipients = 15,
    TooManyRecipients = 16,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AirdropStatus {
    Active,
    Paused,
    Ended,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct AirdropCampaign {
    pub id: u32,
    pub admin: Address,
    pub token: Address,
    pub amount_per_claim: i128,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_timestamp: u64,
    pub end_timestamp: u64,
    pub require_allowlist: bool,
    pub status: AirdropStatus,
    pub created_at: u64,
}
