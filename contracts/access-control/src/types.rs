// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, Symbol};

/// Built-in role identifiers (stored as u32 discriminants for gas efficiency).
/// Callers may treat the `u32` as an opaque role token for custom roles.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Role {
    Admin = 0,
    Minter = 1,
    Burner = 2,
    Pauser = 3,
    Upgrader = 4,
}

/// Instance-storage singleton keys.
#[contracttype]
pub enum InstanceKey {
    Owner,
    Paused,
}

/// Per-address/role persistent storage keys.
#[contracttype]
pub enum DataKey {
    /// Whether `address` holds `role` (role stored as u32).
    HasRole(Address, u32),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    RoleAlreadyGranted = 5,
    RoleNotHeld = 6,
}
