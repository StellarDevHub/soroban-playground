// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

#[contracttype]
pub enum DataKey {
    /// Admin address (instance storage).
    Admin,
    /// Owner of a token: TokenId -> Address.
    Owner(u64),
    /// Approved spender for a token: TokenId -> Address.
    Approved(u64),
    /// Operator approvals: (owner, operator) -> bool.
    OperatorApproval(Address, Address),
    /// Token metadata URI: TokenId -> String.
    TokenMetadata(u64),
    /// Auto-incrementing mint counter (never decrements on burn).
    MintCount,
    /// Global ordered list of all live token IDs.
    AllTokens,
    /// Per-owner ordered list of token IDs.
    OwnerTokens(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    TokenNotFound = 4,
    NotOwner = 5,
    IndexOutOfBounds = 6,
    SelfApproval = 7,
}
