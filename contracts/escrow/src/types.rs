use soroban_sdk::{contracterror, contracttype, Address};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized   = 1,
    NotInitialized       = 2,
    Unauthorized         = 3,
    EscrowNotFound       = 4,
    InvalidState         = 5,
    MilestoneNotFound    = 6,
    InvalidAmount        = 7,
    NoMilestones         = 8,
    TooManyMilestones    = 9,
    AlreadyDisputed      = 10,
    InvalidRuling        = 11,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Pending,    // created, awaiting client deposit
    Active,     // funded, work may proceed
    Completed,  // all milestones paid out
    Disputed,   // arbiter intervention required
    Cancelled,  // voided before completion
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Pending,      // not yet started
    InProgress,   // freelancer working
    UnderReview,  // submitted, client reviewing
    Approved,     // client signed off, awaiting payment release
    Rejected,     // client rejected, back to InProgress
    Paid,         // payment released
}

/// Dispute resolution ruling passed to `resolve_dispute`.
/// Encoded as u32: 0 = FreelancerFavored, 1 = ClientFavored, 2 = Split.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Ruling {
    FreelancerFavored,
    ClientFavored,
    Split,
}

/// A single work milestone within an escrow contract.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Milestone {
    pub id: u32,
    pub amount: i128,
    pub status: MilestoneStatus,
}

/// The escrow agreement between a client and a freelancer.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Escrow {
    pub id: u32,
    pub client: Address,
    pub freelancer: Address,
    pub arbiter: Address,
    pub total_amount: i128,
    pub paid_amount: i128,
    pub milestone_count: u32,
    pub status: EscrowStatus,
    pub created_at: u64,
    /// Basis points (e.g. 200 = 2%) deducted from each payment as arbiter fee.
    pub arbiter_fee_bps: u32,
}

/// Global protocol analytics stored in contract instance storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Analytics {
    pub total_escrows: u32,
    pub active_escrows: u32,
    pub completed_escrows: u32,
    pub disputed_escrows: u32,
    pub cancelled_escrows: u32,
    pub total_value_locked: i128,
    pub total_paid_out: i128,
}

/// Storage key namespace.
#[contracttype]
pub enum DataKey {
    Admin,
    ArbiterFeeBps,
    Initialized,
    EscrowCount,
    Analytics,
    Escrow(u32),
    Milestone(u32, u32), // (escrow_id, milestone_id)
}
