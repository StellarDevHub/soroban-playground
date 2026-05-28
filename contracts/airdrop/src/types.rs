use soroban_sdk::{contracterror, contracttype, Address, BytesN};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidProof = 4,
    AlreadyClaimed = 5,
    ClaimDeadlinePassed = 6,
    ZeroAmount = 7,
    InvalidDeadline = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AirdropInfo {
    pub token: Address,
    pub merkle_root: BytesN<32>,
    pub deadline: u64,
    pub total_amount: i128,
    pub claimed_amount: i128,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    Initialized,
    AirdropInfo,
}

#[contracttype]
pub enum DataKey {
    Claimed(Address),
}
