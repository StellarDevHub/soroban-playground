// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, BytesN, Symbol, Vec};

/// Errors returned by the soulbound token contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract was already initialised.
    AlreadyInitialized = 1,
    /// Contract has not been initialised yet.
    NotInitialized = 2,
    /// Caller is not permitted to perform the action.
    Unauthorized = 3,
    /// Issuer address has no registered signing key.
    UnknownIssuer = 4,
    /// Issuer address is already registered.
    IssuerAlreadyRegistered = 5,
    /// Issuer signature is empty.
    EmptySignature = 6,
    /// Claim payload is empty.
    EmptyPayload = 7,
    /// Attestation does not exist.
    ClaimNotFound = 8,
    /// Attestation has been revoked.
    ClaimRevoked = 9,
    /// Attestation has expired.
    ClaimExpired = 10,
    /// Soulbound tokens can never be transferred.
    NonTransferable = 11,
    /// Soulbound tokens do not support approvals.
    ApprovalsDisabled = 12,
    /// Expiration must be zero (never) or in the future.
    InvalidExpiration = 13,
    /// Guardian threshold must be in `1..=guardians.len()`.
    InvalidThreshold = 14,
    /// Caller is not a registered recovery guardian.
    NotGuardian = 15,
    /// No recovery request exists for the owner.
    RecoveryNotFound = 16,
    /// A recovery request already exists for the owner.
    RecoveryAlreadyActive = 17,
    /// Recovery already reached its threshold and cannot be approved again.
    RecoveryAlreadyExecuted = 18,
    /// The new owner address is invalid for recovery.
    InvalidRecoveryTarget = 19,
    /// Guardian already approved the recovery request.
    AlreadyApproved = 20,
    /// Too many guardians configured for one owner.
    TooManyGuardians = 21,
    /// Guardian list contains a duplicate address.
    DuplicateGuardian = 22,
    /// Arithmetic overflow or underflow occurred.
    ArithmeticOverflow = 23,
}

/// Lifecycle status of an attestation.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum ClaimStatus {
    /// Attestation is active and usable (subject to expiration).
    Active = 0,
    /// Attestation was revoked by its issuer or the admin.
    Revoked = 1,
}

/// A verifiable credential permanently bound to a recipient address.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Attestation {
    /// Sequential id assigned at issuance.
    pub id: u32,
    /// Issuer that signed the attestation.
    pub issuer: Address,
    /// Address the attestation is soulbound to.
    pub recipient: Address,
    /// Credential type (e.g. `KYC`, `DEV`, `GOV`).
    pub claim_type: Symbol,
    /// Ledger timestamp when the attestation was issued.
    pub issued_at: u64,
    /// Ledger timestamp after which the attestation is invalid (`0` = never).
    pub expires_at: u64,
    /// Current status.
    pub status: ClaimStatus,
    /// `sha256(payload)` committed by the issuer's signature.
    pub proof_hash: BytesN<32>,
}

/// Pending or completed social-recovery request for an owner.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RecoveryRequest {
    /// Owner whose soulbound tokens are being recovered.
    pub owner: Address,
    /// Address proposed to receive the recovered tokens.
    pub new_owner: Address,
    /// Guardians that have approved so far.
    pub approvals: Vec<Address>,
    /// Number of approvals required to execute.
    pub threshold: u32,
    /// Ledger timestamp when recovery started.
    pub started_at: u64,
    /// Whether the migration already happened.
    pub executed: bool,
}

/// Instance storage keys.
#[contracttype]
pub enum InstanceKey {
    /// Contract admin address.
    Admin,
    /// Monotonic attestation id counter.
    AttestationCount,
}

/// Persistent/instance data keys.
#[contracttype]
pub enum DataKey {
    /// Registered ed25519 public key for an issuer.
    Issuer(Address),
    /// Attestation by id.
    Attestation(u32),
    /// Ids of every attestation bound to an owner.
    OwnerClaims(Address),
    /// Guarded list of recovery guardians for an owner.
    Guardians(Address),
    /// Number of guardian approvals required for recovery.
    GuardianThreshold(Address),
    /// Pending recovery request for an owner.
    Recovery(Address),
    /// Monotonic ed25519 signature nonce per issuer.
    IssuerNonce(Address),
}
