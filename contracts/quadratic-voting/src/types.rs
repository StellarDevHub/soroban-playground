// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    Active = 0,
    Passed = 1,
    Defeated = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub id: u32,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub status: ProposalStatus,
    /// Quadratic-weighted votes for
    pub votes_for: i128,
    /// Quadratic-weighted votes against
    pub votes_against: i128,
    /// Snapshot of total supply at proposal creation (for quorum calc)
    pub total_supply_snapshot: i128,
    pub vote_start: u64,
    pub vote_end: u64,
}

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProposalCount,
    Paused,
    VotingPeriod,
    /// Total governance token supply
    TotalSupply,
    /// Quorum in basis points (default 400 = 4%)
    QuorumBps,
}

#[contracttype]
pub enum DataKey {
    Proposal(u32),
    /// Governance token balance for an address
    Balance(Address),
    /// Whether address is whitelisted
    Whitelisted(Address),
    /// Voted: (proposal_id, voter)
    Voted(u32, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ProposalNotFound = 4,
    VotingNotActive = 5,
    AlreadyVoted = 6,
    NotWhitelisted = 7,
    ProposalNotActive = 8,
    ContractPaused = 9,
    EmptyTitle = 10,
    VotingStillActive = 11,
    InsufficientVotingPower = 12,
    QuorumNotReached = 13,
}
