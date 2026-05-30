// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    credential_count, get_admin, has_identity, is_initialized, load_credential, load_identity,
    next_credential_id, save_credential, save_identity, set_admin,
};
use crate::types::{Credential, CredentialStatus, Error, Identity, ReputationTier};

#[contract]
pub struct DidRegistry;

#[contractimpl]
impl DidRegistry {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        Ok(())
    }

    /// Register a new DID for the caller.
    pub fn register_identity(
        env: Env,
        owner: Address,
        did: String,
        metadata_hash: u64,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();

        if has_identity(&env, &owner) {
            return Err(Error::IdentityAlreadyExists);
        }

        let now = env.ledger().timestamp();
        save_identity(
            &env,
            &Identity {
                owner,
                did,
                metadata_hash,
                reputation: 0,
                active: true,
                created_at: now,
                updated_at: now,
            },
        );
        Ok(())
    }

    /// Update metadata hash for an existing identity.
    pub fn update_metadata(env: Env, owner: Address, metadata_hash: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();

        let mut identity = load_identity(&env, &owner)?;
        if !identity.active {
            return Err(Error::IdentityDeactivated);
        }
        identity.metadata_hash = metadata_hash;
        identity.updated_at = env.ledger().timestamp();
        save_identity(&env, &identity);
        Ok(())
    }

    /// Deactivate an identity (owner or admin).
    pub fn deactivate_identity(env: Env, owner: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;

        if owner != admin {
            owner.require_auth();
        } else {
            admin.require_auth();
        }

        let mut identity = load_identity(&env, &owner)?;
        identity.active = false;
        identity.updated_at = env.ledger().timestamp();
        save_identity(&env, &identity);
        Ok(())
    }

    /// Issue a verifiable credential to a subject.
    pub fn issue_credential(
        env: Env,
        issuer: Address,
        subject: Address,
        schema_hash: u64,
        data_hash: u64,
        expires_at: u64,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        issuer.require_auth();

        let issuer_identity = load_identity(&env, &issuer)?;
        if !issuer_identity.active {
            return Err(Error::IdentityDeactivated);
        }
        if !has_identity(&env, &subject) {
            return Err(Error::IdentityNotFound);
        }

        let id = next_credential_id(&env);
        save_credential(
            &env,
            &Credential {
                id,
                subject,
                issuer,
                schema_hash,
                data_hash,
                status: CredentialStatus::Active,
                issued_at: env.ledger().timestamp(),
                expires_at,
            },
        );
        Ok(id)
    }

    /// Revoke a credential (admin only).
    pub fn revoke_credential(env: Env, credential_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        require_admin_auth(&env)?;

        let mut cred = load_credential(&env, credential_id)?;
        if cred.status == CredentialStatus::Revoked {
            return Err(Error::CredentialAlreadyRevoked);
        }
        cred.status = CredentialStatus::Revoked;
        save_credential(&env, &cred);
        Ok(())
    }

    /// Adjust reputation score for an identity (admin only).
    pub fn adjust_reputation(env: Env, subject: Address, delta: i32) -> Result<i32, Error> {
        ensure_initialized(&env)?;
        require_admin_auth(&env)?;
        apply_reputation_delta(&env, &subject, delta)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_identity(env: Env, owner: Address) -> Result<Identity, Error> {
        load_identity(&env, &owner)
    }

    pub fn get_credential(env: Env, credential_id: u32) -> Result<Credential, Error> {
        load_credential(&env, credential_id)
    }

    pub fn credential_count(env: Env) -> u32 {
        credential_count(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    // ── Credential Verification ────────────────────────────────────────────

    /// Verify a credential. Verifier must have an active identity.
    pub fn verify_credential(
        env: Env,
        verifier: Address,
        credential_id: u32,
    ) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        verifier.require_auth();

        let verifier_identity = load_identity(&env, &verifier)?;
        if !verifier_identity.active {
            return Err(Error::IdentityDeactivated);
        }

        let cred = load_credential(&env, credential_id)?;
        let now = env.ledger().timestamp();
        let is_valid = is_credential_valid(&cred, now);

        // Mark as expired if applicable
        if !is_valid && cred.status == CredentialStatus::Active && cred.expires_at > 0 && cred.expires_at <= now {
            let mut updated = cred;
            updated.status = CredentialStatus::Expired;
            save_credential(&env, &updated);
        }

        env.events().publish((symbol_short!("verify"),), (credential_id, is_valid));
        Ok(is_valid)
    }

    // ── Reputation System ──────────────────────────────────────────────────

    /// Get reputation tier for an identity.
    pub fn get_reputation_tier(env: Env, identity: Address) -> Result<ReputationTier, Error> {
        ensure_initialized(&env)?;
        let id = load_identity(&env, &identity)?;
        Ok(reputation_tier(id.reputation))
    }

    /// Boost reputation for verified actions (admin only, amount must be > 0).
    pub fn boost_reputation(env: Env, subject: Address, amount: i32) -> Result<i32, Error> {
        ensure_initialized(&env)?;
        require_admin_auth(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidReputation);
        }
        let score = apply_reputation_delta(&env, &subject, amount)?;
        env.events().publish((symbol_short!("boost"),), (&subject, amount));
        Ok(score)
    }

    /// Penalize reputation for violations (admin only, amount must be > 0).
    pub fn penalize_reputation(env: Env, subject: Address, amount: i32) -> Result<i32, Error> {
        ensure_initialized(&env)?;
        require_admin_auth(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidReputation);
        }
        let score = apply_reputation_delta(&env, &subject, -amount)?;
        env.events().publish((symbol_short!("penalize"),), (&subject, amount));
        Ok(score)
    }

    /// Check if identity meets minimum reputation requirement.
    pub fn meets_reputation_requirement(
        env: Env,
        identity: Address,
        min_reputation: i32,
    ) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        let id = load_identity(&env, &identity)?;
        Ok(id.reputation >= min_reputation)
    }

    /// Check if a credential is expired.
    pub fn is_credential_expired(env: Env, credential_id: u32) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        let cred = load_credential(&env, credential_id)?;
        let now = env.ledger().timestamp();
        let expired = match cred.status {
            CredentialStatus::Expired => true,
            CredentialStatus::Active => cred.expires_at > 0 && cred.expires_at <= now,
            _ => false,
        };
        Ok(expired)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin_auth(env: &Env) -> Result<(), Error> {
    let admin = get_admin(env)?;
    admin.require_auth();
    Ok(())
}

/// Apply a signed delta to an identity's reputation. Returns the new score.
fn apply_reputation_delta(env: &Env, subject: &Address, delta: i32) -> Result<i32, Error> {
    let mut identity = load_identity(env, subject)?;
    if !identity.active {
        return Err(Error::IdentityDeactivated);
    }
    identity.reputation = identity.reputation.saturating_add(delta);
    identity.updated_at = env.ledger().timestamp();
    save_identity(env, &identity);
    Ok(identity.reputation)
}

/// Determine the reputation tier for a given score.
fn reputation_tier(score: i32) -> ReputationTier {
    match score {
        r if r < 0 => ReputationTier::Unverified,
        r if r < 100 => ReputationTier::Novice,
        r if r < 500 => ReputationTier::Trusted,
        r if r < 1000 => ReputationTier::Verified,
        _ => ReputationTier::Expert,
    }
}

/// Check if a credential is currently valid (active and not expired).
fn is_credential_valid(cred: &Credential, now: u64) -> bool {
    match cred.status {
        CredentialStatus::Active => cred.expires_at == 0 || cred.expires_at > now,
        _ => false,
    }
}
