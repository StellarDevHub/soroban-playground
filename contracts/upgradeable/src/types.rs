// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, BytesN};

/// Errors returned by the upgradeable contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    TimelockNotElapsed = 4,
    NoPendingUpgrade = 5,
    ContractPaused = 6,
}

/// Keys stored in instance storage (one-per-contract singletons).
#[contracttype]
pub enum InstanceKey {
    Admin,
    Paused,
    /// Ledger sequence at which the pending upgrade was proposed.
    UpgradeProposedAt,
    /// The new WASM hash waiting for the timelock to elapse.
    PendingHash,
    /// Minimum ledger sequences to wait before executing an upgrade (default: 0).
    TimelockLedgers,
}
