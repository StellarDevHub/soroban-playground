// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SportDataStatus {
    Pending,
    Verified,
    Disputed,
    Finalized,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct SportResult {
    pub id: u32,
    pub sport: String,
    pub event_id: String,
    pub home_team: String,
    pub away_team: String,
    pub home_score: u32,
    pub away_score: u32,
    pub timestamp: u64,
    pub status: SportDataStatus,
    pub submitter: Address,
    pub confirmations: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DataSource {
    pub address: Address,
    pub name: String,
    pub active: bool,
    pub submissions: u32,
}

#[contracterror]
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    SourceNotFound = 5,
    SourceAlreadyExists = 6,
    SourceInactive = 7,
    ResultNotFound = 8,
    ResultAlreadyFinalized = 9,
    InvalidThreshold = 10,
    CircuitBreakerActive = 11,
    InvalidEventId = 12,
}
