// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! Type definitions for the Job Marketplace contract

use soroban_sdk::{contracttype, Address, String, Symbol, Vec};

/// Custom error types for the contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Error {
    AlreadyInitialized,
    ContractPaused,
    EmptyField,
    InvalidEscrowAmount,
    MilestoneSumMismatch,
    JobNotFound,
    JobNotOpen,
    JobNotInProgress,
    JobNotCompleted,
    ClientCannotBeFreelancer,
    FreelancerNotFound,
    Unauthorized,
    InvalidMilestoneIndex,
    MilestoneAlreadyReleased,
    CannotCancelJob,
    SkillNotVerified,
    InvalidSkillLevel,
    InvalidValidityPeriod,
    CertificationNotFound,
    DisputeNotFound,
    DisputeAlreadyResolved,
    InvalidRefundAmount,
}

/// Job status enum
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobStatus {
    Open,
    InProgress,
    Completed,
    Disputed,
    Cancelled,
}

/// Milestone structure
#[contracttype]
#[derive(Clone)]
pub struct Milestone {
    pub description: String,
    pub amount: i128,
    pub is_released: bool,
}

/// Job structure
#[contracttype]
#[derive(Clone)]
pub struct Job {
    pub id: u64,
    pub client: Address,
    pub freelancer: Option<Address>,
    pub payment_token: Address,
    pub total_escrow: i128,
    pub released_amount: i128,
    pub status: JobStatus,
    pub milestones: Vec<Milestone>,
    pub required_skills: Vec<Symbol>,
    pub created_at: u64,
    pub accepted_at: Option<u64>,
    pub completed_at: Option<u64>,
}

/// Skill verification record
#[contracttype]
#[derive(Clone)]
pub struct Skill {
    pub user: Address,
    pub skill: Symbol,
    pub level: u32,
    pub verified_at: u64,
    pub verified_by: Address,
}

/// Certification record
#[contracttype]
#[derive(Clone)]
pub struct Certification {
    pub user: Address,
    pub name: String,
    pub issuer: String,
    pub issued_at: u64,
    pub valid_until: u64,
}

/// Dispute record
#[contracttype]
#[derive(Clone)]
pub struct Dispute {
    pub id: u64,
    pub job_id: u64,
    pub raised_by: Address,
    pub reason: String,
    pub created_at: u64,
    pub resolved_at: Option<u64>,
    pub resolution: Option<String>,
    pub resolved_by: Option<Address>,
}
