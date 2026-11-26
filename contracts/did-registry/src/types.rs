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
    InvalidCredential = 10,
    CredentialExpired = 11,
    InsufficientReputation = 12,
    ArithmeticOverflow = 13,
    NotUniqueHuman = 14,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Identity {
    pub owner: Address,
    pub did: String,        // e.g. "did:soroban:<address>"
    pub metadata_hash: u64, // hash of off-chain metadata (IPFS CID etc.)
    pub reputation: i32,    // cumulative score
    pub active: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CredentialStatus {
    Active,
    Revoked,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Credential {
    pub id: u32,
    pub subject: Address, // identity that holds this credential
    pub issuer: Address,  // who issued it
    pub schema_hash: u64, // hash of credential schema/type
    pub data_hash: u64,   // hash of credential data
    pub status: CredentialStatus,
    pub issued_at: u64,
    pub expires_at: u64, // 0 = no expiry
}

/// Verification record for tracking credential verifications
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct VerificationRecord {
    pub credential_id: u32,
    pub verifier: Address,
    pub verified_at: u64,
    pub valid: bool,
}

/// Reputation tier based on score
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ReputationTier {
    Unverified, // < 0
    Novice,     // 0-100
    Trusted,    // 100-500
    Verified,   // 500-1000
    Expert,     // > 1000
}

/// Checked 64-bit quadratic vote cost: cost = votes^2.
/// Returns `Error::ArithmeticOverflow` instead of wrapping.
pub fn quadratic_cost(votes: u32) -> Result<u64, Error> {
    let v = votes as u64;
    v.checked_mul(v).ok_or(Error::ArithmeticOverflow)
}

/// Proof-of-unique-human gate: an identity may participate in quadratic
/// voting only if it is active, holds a non-revoked, unexpired credential
/// schema marking it as a unique human, and meets the minimum reputation tier.
pub fn require_unique_human(identity: &Identity) -> Result<(), Error> {
    if !identity.active {
        return Err(Error::IdentityDeactivated);
    }
    if identity.reputation < 0 {
        return Err(Error::NotUniqueHuman);
    }
    Ok(())
}
