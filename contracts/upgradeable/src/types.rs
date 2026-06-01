// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::contracttype;

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
