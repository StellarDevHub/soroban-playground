// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, BytesN, String};

// ── Upgrade ───────────────────────────────────────────────────────────────────

/// Stored when an upgrade is scheduled; cleared on execution or cancellation.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct UpgradePending {
    /// The WASM hash that was scheduled.
    pub wasm_hash: BytesN<32>,
    /// Unix timestamp after which `execute_upgrade` may proceed.
    pub execute_after: u64,
}

// ── Proposal lifecycle ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    Draft = 0,
    Active = 1,
    Passed = 2,
    Defeated = 3,
    Executed = 4,
    Cancelled = 5,
}

// ── Vote choice ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VoteChoice {
    For = 0,
    Against = 1,
    Abstain = 2,
}

// ── Structs ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Proposal {
    pub id: u32,
    pub proposer: Address,
    pub title: String,
    pub description: String,
    pub status: ProposalStatus,
    pub votes_for: i128,
    pub votes_against: i128,
    pub votes_abstain: i128,
    /// Snapshot of total supply at proposal creation (for quorum calc).
    pub total_supply_snapshot: i128,
    /// Monotonic checkpoint index captured when the proposal is created.
    pub snapshot_id: u32,
    /// Ledger timestamp when voting opens.
    pub vote_start: u64,
    /// Ledger timestamp when voting closes.
    pub vote_end: u64,
    /// Ledger timestamp after which the proposal can be executed.
    pub execute_after: u64,
    /// Deposit in stroops (refundable if passed).
    pub deposit: i128,
    /// Ledger timestamp until which the guardian may veto (cancel) the proposal.
    pub veto_deadline: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    ProposalCount,
    /// Total governance token supply.
    TotalSupply,
    /// Quorum in basis points (default 400 = 4%).
    QuorumBps,
    /// Voting period in seconds (default 7 days).
    VotingPeriod,
    /// Execution delay in seconds (default 2 days).
    ExecDelay,
    /// Required deposit in stroops.
    Deposit,
    /// Pending upgrade (set by schedule_upgrade, cleared by execute_upgrade).
    PendingUpgrade,
    /// Guardian address authorised to veto proposals during the timelock window.
    Guardian,
    /// Minimum execution timelock in seconds (enforced floor, 48 hours).
    MinTimelock,
    /// Monotonic index for historical balance/delegation mutations.
    CheckpointCount,
}

#[contracttype]
pub enum DataKey {
    Proposal(u32),
    /// Governance token balance for an address.
    Balance(Address),
    /// Delegate: who `addr` has delegated to.
    Delegate(Address),
    /// Whether `voter` has voted on proposal `id`: (proposal_id, voter).
    Voted(u32, Address),
    /// Historical checkpointed voting balance for `addr` at a snapshot ledger timestamp.
    BalanceCheckpoint(Address, u32),
    /// Total supply checkpoint at a monotonic snapshot index.
    TotalSupplyCheckpoint(u32),
    /// Checkpoint indexes belonging to an account's balance history.
    CheckpointIndices(Address),
    /// Historical delegate at a checkpoint index; None means self-delegated.
    DelegateCheckpoint(Address, u32),
    /// Checkpoint indexes belonging to an account's delegation history.
    DelegateCheckpointIndices(Address),
}

// ── Errors ────────────────────────────────────────────────────────────────────

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
    InsufficientVotingPower = 7,
    QuorumNotReached = 8,
    ProposalNotPassed = 9,
    TimelockActive = 10,
    ProposalAlreadyExecuted = 11,
    EmptyTitle = 12,
    InsufficientDeposit = 13,
    SelfDelegation = 14,
    ProposalNotActive = 15,
    /// No upgrade has been scheduled via schedule_upgrade.
    UpgradeNotScheduled = 16,
    /// The 48-hour timelock has not yet elapsed since schedule_upgrade.
    UpgradeTimelockActive = 17,
    /// The wasm_hash passed to execute_upgrade does not match the scheduled hash.
    UpgradeHashMismatch = 18,
    /// The requested delay is below the mandatory 48-hour minimum.
    UpgradeDelayTooShort = 19,
    /// Caller is not the configured guardian.
    NotGuardian = 20,
    /// The guardian veto window has closed; execution may proceed.
    VetoWindowClosed = 21,
    /// Proposal was vetoed/cancelled and cannot be executed.
    ProposalCancelled = 22,
    /// Execution delay is below the mandatory 48-hour minimum.
    ExecDelayTooShort = 23,
}
