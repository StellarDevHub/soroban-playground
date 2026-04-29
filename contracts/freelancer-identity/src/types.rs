use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    Paused = 4,
    ProfileNotFound = 5,
    ProfileAlreadyExists = 6,
    ProfileInactive = 7,
    EmptyField = 8,
    InvalidScore = 9,
    InvalidWeight = 10,
    PortfolioNotFound = 11,
    EndorsementNotFound = 12,
    AlreadyRevoked = 13,
    SelfEndorsement = 14,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct FreelancerProfile {
    pub owner: Address,
    pub display_hash: u64,
    pub portfolio_hash: u64,
    pub verified_projects: u32,
    pub endorsement_count: u32,
    pub reputation: i32,
    pub active: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PortfolioVerification {
    pub id: u32,
    pub freelancer: Address,
    pub verifier: Address,
    pub project_hash: u64,
    pub evidence_hash: u64,
    pub score: u32,
    pub created_at: u64,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SkillEndorsement {
    pub id: u32,
    pub subject: Address,
    pub endorser: Address,
    pub skill_hash: u64,
    pub evidence_hash: u64,
    pub weight: u32,
    pub created_at: u64,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct IdentityStats {
    pub profile_count: u32,
    pub verification_count: u32,
    pub endorsement_count: u32,
    pub active_profiles: u32,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    Recovery,
    Paused,
    ProfileCount,
    ActiveProfileCount,
    VerificationCount,
    EndorsementCount,
}

#[contracttype]
pub enum DataKey {
    Profile(Address),
    Verifier(Address),
    Verification(u32),
    Endorsement(u32),
}
