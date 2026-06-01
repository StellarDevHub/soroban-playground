// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracttype, String};

/// Semantic version stored on-chain.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Version {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    /// Optional human-readable label (e.g. "alpha", "stable").
    pub label: String,
}

/// One record in the migration history log.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MigrationRecord {
    pub from_index: u32,
    pub to_index: u32,
    pub ledger: u64,
}

/// Instance-storage singleton keys.
#[contracttype]
pub enum InstanceKey {
    Admin,
    /// Index into the version history vec pointing at the current version.
    CurrentIndex,
    /// Total number of versions registered so far.
    VersionCount,
    /// Total number of migration records.
    MigrationCount,
}

/// Per-item persistent storage keys.
#[contracttype]
pub enum DataKey {
    /// Version at position `n` in the history.
    VersionAt(u32),
    /// Migration record at position `n`.
    MigrationAt(u32),
}
