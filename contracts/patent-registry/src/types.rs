use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerificationStatus {
    Pending,
    Verified,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LicenseStatus {
    Open,
    Accepted,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Patent {
    pub id: u32,
    pub owner: Address,
    pub title: String,
    pub description: String,
    pub content_hash: String,
    pub metadata_uri: String,
    pub verification_status: VerificationStatus,
    pub verifier: Option<Address>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct LicenseOffer {
    pub id: u32,
    pub patent_id: u32,
    pub owner: Address,
    pub licensee: Option<Address>,
    pub terms_uri: String,
    pub payment_amount: i128,
    pub payment_token: String,
    pub status: LicenseStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub accepted_at: u64,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    Verifier,
    PatentCount,
    OfferCount,
    Paused,
}

#[contracttype]
pub enum DataKey {
    Patent(u32),
    Offer(u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    PatentNotFound = 4,
    LicenseOfferNotFound = 5,
    EmptyField = 6,
    InvalidPaymentAmount = 7,
    AlreadyAccepted = 8,
    ContractPaused = 9,
    InvalidLicensee = 10,
}
