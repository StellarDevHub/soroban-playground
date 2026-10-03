// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Soulbound Token (SBT)
//!
//! Non-transferable credential token binding verifiable attestations to a
//! Stellar address. Implements the production readiness requirements from
//! issue #1383:
//!
//! 1. **Non-transferable standard** — [`SoulboundToken::transfer`],
//!    [`SoulboundToken::transfer_from`] and [`SoulboundToken::approve`] are
//!    hard-wired to fail, so a credential can never leave its recipient.
//! 2. **Issuer attestations** — only admin-registered issuers can mint, and
//!    each attestation carries an ed25519 signature over a nonce-bound payload
//!    plus an optional expiration timestamp.
//! 3. **Social recovery** — an owner can appoint guardians who, collectively,
//!    migrate every active attestation to a new address if the owner's key is
//!    lost.
//!
//! ## Lifecycle
//! 1. Admin calls [`SoulboundToken::initialize`].
//! 2. Admin registers issuers with [`SoulboundToken::register_issuer`].
//! 3. An issuer calls [`SoulboundToken::issue_attestation`] with a signed
//!    payload; the claim is bound to the recipient.
//! 4. Issuer or admin can call [`SoulboundToken::revoke_attestation`].
//! 5. Owners configure guardians and can recover a lost key.

#![no_std]

mod storage;
#[cfg(test)]
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec};

use crate::storage::{
    clear_guardians, get_admin, get_attestation, get_attestation_count, get_attestation_opt,
    get_guardian_threshold, get_guardians, get_issuer, get_issuer_nonce, get_owner_claims,
    get_recovery, is_initialized, is_issuer, push_owner_claim, remove_issuer, remove_owner_claim,
    remove_recovery, set_admin, set_attestation, set_attestation_count, set_guardian_threshold,
    set_guardians, set_issuer, set_issuer_nonce, set_owner_claims, set_recovery,
};
use crate::types::{Attestation, ClaimStatus, Error, RecoveryRequest};

/// Maximum number of guardians a single owner may appoint.
const MAX_GUARDIANS: u32 = 10;

/// Domain tag mixed into every issuer signature preimage.
const SIGNING_DOMAIN: &[u8] = b"SBT1";

#[contract]
pub struct SoulboundToken;

#[contractimpl]
impl SoulboundToken {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin. Must be called exactly once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_attestation_count(&env, 0);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    /// Transfer admin rights to a new address (admin only).
    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = get_admin(&env)?;
        admin.require_auth();
        set_admin(&env, &new_admin);
        env.events()
            .publish((symbol_short!("adm_tx"),), new_admin);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    // ── Issuer registry (admin only) ──────────────────────────────────────────

    /// Register an issuer together with its ed25519 signing key. Only the
    /// admin may register issuers.
    pub fn register_issuer(env: Env, issuer: Address, pubkey: BytesN<32>) -> Result<(), Error> {
        require_admin(&env)?;
        if is_issuer(&env, &issuer) {
            return Err(Error::IssuerAlreadyRegistered);
        }
        set_issuer(&env, &issuer, &pubkey);
        env.events()
            .publish((symbol_short!("iss_reg"),), issuer);
        Ok(())
    }

    /// Remove an issuer. Existing attestations remain valid history. Admin only.
    pub fn remove_issuer(env: Env, issuer: Address) -> Result<(), Error> {
        require_admin(&env)?;
        if !is_issuer(&env, &issuer) {
            return Err(Error::UnknownIssuer);
        }
        remove_issuer(&env, &issuer);
        env.events()
            .publish((symbol_short!("iss_rm"),), issuer);
        Ok(())
    }

    pub fn is_issuer(env: Env, issuer: Address) -> bool {
        is_issuer(&env, &issuer)
    }

    pub fn get_issuer_pubkey(env: Env, issuer: Address) -> Option<BytesN<32>> {
        get_issuer(&env, &issuer)
    }

    /// Current signature nonce for an issuer. The issuer's signed preimage must
    /// embed this value; it increments after every successful issuance.
    pub fn issuer_nonce(env: Env, issuer: Address) -> u64 {
        get_issuer_nonce(&env, &issuer)
    }

    // ── Issuance ──────────────────────────────────────────────────────────────

    /// Issue a soulbound attestation to `recipient`.
    ///
    /// The issuer must be registered and must authorise the call. Its ed25519
    /// key verifies `signature` over:
    ///
    /// ```text
    /// b"SBT1" || pubkey(32) || payload || expiration_be(8) || nonce_be(8)
    /// ```
    ///
    /// `expiration == 0` means the attestation never expires. Returns the new
    /// attestation id.
    ///
    /// Like `require_auth`, an invalid signature traps rather than returning an
    /// error.
    pub fn issue_attestation(
        env: Env,
        issuer: Address,
        recipient: Address,
        claim_type: Symbol,
        expiration: u64,
        payload: Bytes,
        signature: BytesN<64>,
    ) -> Result<u32, Error> {
        assert_initialized(&env)?;
        issuer.require_auth();

        let pubkey = get_issuer(&env, &issuer).ok_or(Error::UnknownIssuer)?;
        if payload.is_empty() {
            return Err(Error::EmptyPayload);
        }

        let now = env.ledger().timestamp();
        if expiration != 0 && expiration <= now {
            return Err(Error::InvalidExpiration);
        }

        let nonce = get_issuer_nonce(&env, &issuer);
        let mut preimage = Bytes::from_slice(&env, SIGNING_DOMAIN);
        preimage.append(&Bytes::from_array(&env, &pubkey.to_array()));
        preimage.append(&payload);
        preimage.append(&Bytes::from_array(&env, &expiration.to_be_bytes()));
        preimage.append(&Bytes::from_array(&env, &nonce.to_be_bytes()));
        env.crypto().ed25519_verify(&pubkey, &preimage, &signature);

        let id = get_attestation_count(&env)
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        let proof_hash = env.crypto().sha256(&payload);

        let attestation = Attestation {
            id,
            issuer: issuer.clone(),
            recipient: recipient.clone(),
            claim_type: claim_type.clone(),
            issued_at: now,
            expires_at: expiration,
            status: ClaimStatus::Active,
            proof_hash,
        };
        set_attestation(&env, &attestation);
        set_attestation_count(&env, id);
        push_owner_claim(&env, &recipient, id);
        set_issuer_nonce(&env, &issuer, nonce + 1);

        env.events().publish(
            (symbol_short!("issued"), id),
            (issuer, recipient, claim_type, expiration),
        );
        Ok(id)
    }

    /// Revoke an attestation. Callable by the original issuer or the admin.
    pub fn revoke_attestation(env: Env, caller: Address, claim_id: u32) -> Result<(), Error> {
        assert_initialized(&env)?;
        let mut attestation = get_attestation(&env, claim_id)?;
        caller.require_auth();

        let admin = get_admin(&env)?;
        if caller != attestation.issuer && caller != admin {
            return Err(Error::Unauthorized);
        }
        if attestation.status == ClaimStatus::Revoked {
            return Err(Error::ClaimRevoked);
        }

        attestation.status = ClaimStatus::Revoked;
        set_attestation(&env, &attestation);
        remove_owner_claim(&env, &attestation.recipient, claim_id);

        env.events()
            .publish((symbol_short!("revoked"), claim_id), caller);
        Ok(())
    }

    // ── Non-transferable enforcement ──────────────────────────────────────────

    /// Soulbound tokens can never be transferred. Always fails with
    /// [`Error::NonTransferable`].
    pub fn transfer(env: Env, from: Address, to: Address, claim_id: u32) -> Result<(), Error> {
        let _ = (&env, from, to, claim_id);
        Err(Error::NonTransferable)
    }

    /// Soulbound tokens can never be transferred. Always fails with
    /// [`Error::NonTransferable`].
    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        claim_id: u32,
    ) -> Result<(), Error> {
        let _ = (&env, spender, from, to, claim_id);
        Err(Error::NonTransferable)
    }

    /// Approvals are disabled for soulbound tokens. Always fails with
    /// [`Error::ApprovalsDisabled`].
    pub fn approve(env: Env, owner: Address, spender: Address, claim_id: u32) -> Result<(), Error> {
        let _ = (&env, owner, spender, claim_id);
        Err(Error::ApprovalsDisabled)
    }

    /// Soulbound tokens support no allowance. Always returns `0`.
    pub fn allowance(env: Env, owner: Address, spender: Address) -> u32 {
        let _ = (&env, owner, spender);
        0
    }

    /// This credential standard is always non-transferable.
    pub fn non_transferable(env: Env) -> bool {
        let _ = &env;
        true
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Number of active (non-revoked) attestations bound to `owner`.
    pub fn balance_of(env: Env, owner: Address) -> u32 {
        let claims = get_owner_claims(&env, &owner);
        let mut count = 0u32;
        for id in claims.iter() {
            if let Some(attestation) = get_attestation_opt(&env, id) {
                if attestation.status == ClaimStatus::Active {
                    count += 1;
                }
            }
        }
        count
    }

    /// Recipient a claim is soulbound to.
    pub fn owner_of(env: Env, claim_id: u32) -> Result<Address, Error> {
        Ok(get_attestation(&env, claim_id)?.recipient)
    }

    /// Fetch an attestation by id.
    pub fn get_attestation(env: Env, claim_id: u32) -> Result<Attestation, Error> {
        get_attestation(&env, claim_id)
    }

    /// Whether an attestation is currently valid: active and not expired.
    pub fn is_attestation_valid(env: Env, claim_id: u32) -> Result<bool, Error> {
        let attestation = get_attestation(&env, claim_id)?;
        Ok(is_valid(&env, &attestation))
    }

    /// Whether `owner` holds a currently valid attestation of `claim_type`.
    pub fn has_valid_claim(env: Env, owner: Address, claim_type: Symbol) -> bool {
        let claims = get_owner_claims(&env, &owner);
        for id in claims.iter() {
            if let Some(attestation) = get_attestation_opt(&env, id) {
                if attestation.claim_type == claim_type && is_valid(&env, &attestation) {
                    return true;
                }
            }
        }
        false
    }

    /// Ids of every attestation ever issued to `owner` (including revoked).
    pub fn get_owner_claims(env: Env, owner: Address) -> Vec<u32> {
        get_owner_claims(&env, &owner)
    }

    pub fn attestation_count(env: Env) -> u32 {
        get_attestation_count(&env)
    }

    // ── Social recovery ───────────────────────────────────────────────────────

    /// Configure the guardians that can recover an owner's credentials. The
    /// owner must authorise this call. `threshold` is the number of guardian
    /// approvals required to execute a recovery.
    pub fn set_guardians(
        env: Env,
        owner: Address,
        guardians: Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        assert_initialized(&env)?;
        owner.require_auth();

        if guardians.is_empty() {
            return Err(Error::InvalidThreshold);
        }
        if guardians.len() > MAX_GUARDIANS {
            return Err(Error::TooManyGuardians);
        }
        if threshold == 0 || threshold > guardians.len() {
            return Err(Error::InvalidThreshold);
        }
        for i in 0..guardians.len() {
            let guardian = guardians.get_unchecked(i);
            if guardian == owner {
                return Err(Error::InvalidRecoveryTarget);
            }
            for j in (i + 1)..guardians.len() {
                if guardians.get_unchecked(j) == guardian {
                    return Err(Error::DuplicateGuardian);
                }
            }
        }

        set_guardians(&env, &owner, &guardians);
        set_guardian_threshold(&env, &owner, threshold);
        env.events()
            .publish((symbol_short!("grd_set"),), (owner, threshold));
        Ok(())
    }

    pub fn get_guardians(env: Env, owner: Address) -> Vec<Address> {
        get_guardians(&env, &owner)
    }

    pub fn get_guardian_threshold(env: Env, owner: Address) -> u32 {
        get_guardian_threshold(&env, &owner)
    }

    /// Begin recovering `owner`'s credentials to `new_owner`. The caller must
    /// be one of the owner's guardians.
    pub fn start_recovery(
        env: Env,
        caller: Address,
        owner: Address,
        new_owner: Address,
    ) -> Result<(), Error> {
        assert_initialized(&env)?;
        caller.require_auth();

        if new_owner == owner {
            return Err(Error::InvalidRecoveryTarget);
        }
        let guardians = get_guardians(&env, &owner);
        if !guardians.contains(&caller) {
            return Err(Error::NotGuardian);
        }
        if get_recovery(&env, &owner).is_some() {
            return Err(Error::RecoveryAlreadyActive);
        }

        let threshold = get_guardian_threshold(&env, &owner);
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }

        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(caller.clone());
        let request = RecoveryRequest {
            owner: owner.clone(),
            new_owner: new_owner.clone(),
            approvals,
            threshold,
            started_at: env.ledger().timestamp(),
            executed: false,
        };
        set_recovery(&env, &request);

        env.events().publish(
            (symbol_short!("rec_str"),),
            (caller, owner, new_owner),
        );
        Ok(())
    }

    /// Approve an active recovery request. When the threshold is reached the
    /// owner's active attestations migrate to the proposed new owner.
    pub fn approve_recovery(env: Env, guardian: Address, owner: Address) -> Result<(), Error> {
        assert_initialized(&env)?;
        guardian.require_auth();

        let guardians = get_guardians(&env, &owner);
        if !guardians.contains(&guardian) {
            return Err(Error::NotGuardian);
        }

        let mut request = get_recovery(&env, &owner).ok_or(Error::RecoveryNotFound)?;
        if request.executed {
            return Err(Error::RecoveryAlreadyExecuted);
        }
        if request.approvals.contains(&guardian) {
            return Err(Error::AlreadyApproved);
        }

        request.approvals.push_back(guardian.clone());
        if request.approvals.len() >= request.threshold {
            migrate_claims(&env, &owner, &request.new_owner);
            clear_guardians(&env, &owner);
            request.executed = true;
            env.events().publish(
                (symbol_short!("rec_ok"),),
                (owner.clone(), request.new_owner.clone()),
            );
        }
        let executed = request.executed;
        set_recovery(&env, &request);

        env.events().publish(
            (symbol_short!("rec_app"),),
            (guardian, owner, executed),
        );
        Ok(())
    }

    /// Cancel a pending recovery request. Only the owner can cancel, which also
    /// proves they still control their key.
    pub fn cancel_recovery(env: Env, owner: Address) -> Result<(), Error> {
        assert_initialized(&env)?;
        owner.require_auth();

        let request = get_recovery(&env, &owner).ok_or(Error::RecoveryNotFound)?;
        if request.executed {
            return Err(Error::RecoveryAlreadyExecuted);
        }
        remove_recovery(&env, &owner);
        env.events()
            .publish((symbol_short!("rec_cnl"),), owner);
        Ok(())
    }

    pub fn get_recovery(env: Env, owner: Address) -> Option<RecoveryRequest> {
        get_recovery(&env, &owner)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn assert_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin(env: &Env) -> Result<(), Error> {
    let admin = get_admin(env)?;
    admin.require_auth();
    Ok(())
}

/// A claim is valid when it is active and either never expires or expires in
/// the future.
fn is_valid(env: &Env, attestation: &Attestation) -> bool {
    attestation.status == ClaimStatus::Active
        && (attestation.expires_at == 0 || attestation.expires_at > env.ledger().timestamp())
}

/// Move every active attestation from `owner` to `new_owner`.
///
/// Revoked attestations stay locked to the original owner and are dropped from
/// the recovered index.
fn migrate_claims(env: &Env, owner: &Address, new_owner: &Address) {
    let claims = get_owner_claims(env, owner);
    let mut migrated: Vec<u32> = get_owner_claims(env, new_owner);

    for id in claims.iter() {
        if let Some(mut attestation) = get_attestation_opt(env, id) {
            if attestation.status == ClaimStatus::Active {
                attestation.recipient = new_owner.clone();
                set_attestation(env, &attestation);
                migrated.push_back(id);
            }
        }
    }

    set_owner_claims(env, new_owner, &migrated);
    set_owner_claims(env, owner, &Vec::new(env));
}
