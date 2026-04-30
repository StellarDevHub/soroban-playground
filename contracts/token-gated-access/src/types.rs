// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

// ── Membership tier ───────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Tier {
    Basic = 0,
    Premium = 1,
    Elite = 2,
}

// ── NFT membership record ─────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Membership {
    pub token_id: u64,
    pub owner: Address,
    pub tier: Tier,
    pub issued_at: u64,
    pub expires_at: u64, // 0 = never expires
    pub metadata_uri: String,
}

// ── Analytics snapshot ────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Analytics {
    pub total_members: u64,
    pub basic_count: u64,
    pub premium_count: u64,
    pub elite_count: u64,
    pub total_access_checks: u64,
    pub last_updated: u64,
}

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum InstanceKey {
    Admin,
    Paused,
    NextTokenId,
    Analytics,
}

#[contracttype]
pub enum DataKey {
    /// NFT membership by token_id
    Membership(u64),
    /// token_id owned by address (one active membership per address)
    OwnerToken(Address),
    /// access log count per address
    AccessCount(Address),
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    AlreadyMember = 4,
    NotMember = 5,
    MembershipExpired = 6,
    InsufficientTier = 7,
    Paused = 8,
    TokenNotFound = 9,
    InvalidExpiry = 10,
}
