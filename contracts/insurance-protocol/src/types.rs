// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract already initialized.
    AlreadyInitialized = 1,
    /// Contract not yet initialized.
    NotInitialized = 2,
    /// Caller is not the admin.
    Unauthorized = 3,
    /// Coverage product does not exist.
    ProductNotFound = 4,
    /// Policy does not exist.
    PolicyNotFound = 5,
    /// Claim does not exist.
    ClaimNotFound = 6,
    /// Premium must be greater than zero.
    ZeroPremium = 7,
    /// Coverage amount must be greater than zero.
    ZeroCoverage = 8,
    /// Policy is not active (expired or cancelled).
    PolicyInactive = 9,
    /// Claim is not in a votable state.
    ClaimNotVotable = 10,
    /// Voter has already cast a vote on this claim.
    AlreadyVoted = 11,
    /// Claim has already been finalised.
    ClaimAlreadyFinalised = 12,
    /// Not enough votes to finalise.
    InsufficientVotes = 13,
    /// Product name must not be empty.
    EmptyName = 14,
    /// Risk score out of range (1–100).
    InvalidRiskScore = 15,
    /// Policy has already been purchased by this address.
    PolicyAlreadyExists = 16,
    /// Voting period has not ended yet.
    VotingPeriodActive = 17,
}

/// Status of a claim.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ClaimStatus {
    /// Awaiting votes.
    Pending = 0,
    /// Approved by voters.
    Approved = 1,
    /// Rejected by voters.
    Rejected = 2,
}

/// A coverage product listed on the marketplace.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct CoverageProduct {
    /// Human-readable name.
    pub name: String,
    /// Annual premium in stroops.
    pub premium: i128,
    /// Maximum payout per claim in stroops.
    pub coverage_amount: i128,
    /// Risk score 1–100 (higher = riskier).
    pub risk_score: u32,
    /// Whether the product is accepting new policies.
    pub is_active: bool,
}

/// An individual insurance policy purchased by a user.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy {
    pub holder: Address,
    pub product_id: u32,
    /// Ledger timestamp when the policy was purchased.
    pub start_ts: u64,
    /// Ledger timestamp when the policy expires (start + 1 year).
    pub expiry_ts: u64,
    /// Whether the policy is still active.
    pub is_active: bool,
}

/// A claim filed against a policy.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Claim {
    pub policy_id: u32,
    pub claimant: Address,
    /// Description of the loss event.
    pub description: String,
    pub status: ClaimStatus,
    /// Votes in favour of approval.
    pub votes_for: u32,
    /// Votes against approval.
    pub votes_against: u32,
    /// Ledger timestamp after which voting can be finalised.
    pub voting_ends_ts: u64,
}

/// Instance-level storage keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    ProductCount,
    PolicyCount,
    ClaimCount,
}

/// Persistent storage keys.
#[contracttype]
pub enum DataKey {
    Product(u32),
    Policy(u32),
    Claim(u32),
    /// Whether a voter has voted on a claim: (claim_id, voter).
    Vote(u32, Address),
}
