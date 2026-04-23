use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    IdentityNotFound = 3,
    IdentityAlreadyExists = 4,
    CredentialNotFound = 5,
    CredentialAlreadyRevoked = 6,
    Unauthorized = 7,
    InvalidReputation = 8,
    IdentityDeactivated = 9,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Identity {
    pub owner: Address,
    pub did: String,          // e.g. "did:soroban:<address>"
    pub metadata_hash: u64,   // hash of off-chain metadata (IPFS CID etc.)
    pub reputation: i32,      // cumulative score
    pub active: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CredentialStatus {
    Active,
    Revoked,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Credential {
    pub id: u32,
    pub subject: Address,     // identity that holds this credential
    pub issuer: Address,      // who issued it
    pub schema_hash: u64,     // hash of credential schema/type
    pub data_hash: u64,       // hash of credential data
    pub status: CredentialStatus,
    pub issued_at: u64,
    pub expires_at: u64,      // 0 = no expiry
}
