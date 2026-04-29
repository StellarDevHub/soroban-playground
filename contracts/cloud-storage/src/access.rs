// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};
use crate::storage::{get_admin, is_paused};
use crate::errors::{ensure_initialized, ensure_not_paused, ensure_owner, ContractError};

/// Ensures the contract is initialized.
pub fn require_initialized(env: &Env) -> Result<(), ContractError> {
    let initialized = crate::storage::is_initialized(env);
    ensure_initialized(initialized)
}

/// Ensures the contract is not paused.
pub fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    let paused = is_paused(env);
    ensure_not_paused(paused)
}

/// Ensures the caller is the admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), ContractError> {
    let admin = get_admin(env).ok_or(ContractError::NotInitialized)?;
    if caller != &admin {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}

/// Ensures the caller is the owner of the file.
pub fn require_file_owner(caller: &Address, owner: &Address) -> Result<(), ContractError> {
    ensure_owner(caller, owner)
}

/// Ensures the caller is the node operator (authenticates as node address).
pub fn require_node_operator(node: &Address, caller: &Address) -> Result<(), ContractError> {
    if node != caller {
        return Err(ContractError::Unauthorized);
    }
    Ok(())
}
