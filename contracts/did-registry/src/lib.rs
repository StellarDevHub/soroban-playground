#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

use crate::storage::{
    credential_count, get_admin, has_identity, is_initialized, load_credential, load_identity,
    next_credential_id, save_credential, save_identity, set_admin,
};
use crate::types::{Credential, CredentialStatus, Error, Identity};

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
    /// `did` — the DID string (e.g. "did:soroban:G...")
    /// `metadata_hash` — u64 hash of off-chain metadata
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
    pub fn update_metadata(
        env: Env,
        owner: Address,
        metadata_hash: u64,
    ) -> Result<(), Error> {
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

        // Allow owner or admin
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
    /// Only callable by a registered, active identity (the issuer).
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

        // Issuer must have an active identity
        let issuer_identity = load_identity(&env, &issuer)?;
        if !issuer_identity.active {
            return Err(Error::IdentityDeactivated);
        }
        // Subject must also be registered
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

    /// Revoke a credential (issuer or admin only).
    pub fn revoke_credential(env: Env, credential_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut cred = load_credential(&env, credential_id)?;
        if cred.status == CredentialStatus::Revoked {
            return Err(Error::CredentialAlreadyRevoked);
        }
        cred.status = CredentialStatus::Revoked;
        save_credential(&env, &cred);
        Ok(())
    }

    /// Adjust reputation score for an identity (admin only).
    /// `delta` can be positive or negative.
    pub fn adjust_reputation(
        env: Env,
        subject: Address,
        delta: i32,
    ) -> Result<i32, Error> {
        ensure_initialized(&env)?;
        let admin = get_admin(&env)?;
        admin.require_auth();

        let mut identity = load_identity(&env, &subject)?;
        if !identity.active {
            return Err(Error::IdentityDeactivated);
        }
        identity.reputation = identity.reputation.saturating_add(delta);
        identity.updated_at = env.ledger().timestamp();
        save_identity(&env, &identity);
        Ok(identity.reputation)
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
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}
