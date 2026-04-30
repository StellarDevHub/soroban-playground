use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PatentNotFound = 4,
    LicenseNotFound = 5,
    ContractPaused = 6,
    InvalidInput = 7,
    NotPatentOwner = 8,
    NotVerifier = 9,
    AlreadyVerified = 10,
    LicenseNotOpen = 11,
    LicenseAlreadyAccepted = 12,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PatentStatus {
    Registered,
    Verified,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LicenseStatus {
    Open,
    Accepted,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Patent {
    pub owner: Address,
    pub title: String,
    pub metadata_uri: String,
    pub metadata_hash: String,
    pub status: PatentStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub verified_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LicenseOffer {
    pub patent_id: u32,
    pub licensor: Address,
    pub licensee: Address,
    pub terms: String,
    pub payment_amount: i128,
    pub payment_currency: String,
    pub status: LicenseStatus,
    pub created_at: u64,
    pub accepted_at: u64,
    pub payment_reference: String,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    Verifier,
    PatentCount,
    LicenseCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Patent(u32),
    License(u32),
}
