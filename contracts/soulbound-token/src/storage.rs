// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, BytesN, Env, Vec};

use crate::types::{Attestation, DataKey, Error, InstanceKey, RecoveryRequest};

// ── Admin / initialization ───────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

// ── Attestation counter ──────────────────────────────────────────────────────

pub fn get_attestation_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::AttestationCount)
        .unwrap_or(0)
}

pub fn set_attestation_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::AttestationCount, &count);
}

// ── Issuer registry ──────────────────────────────────────────────────────────

pub fn set_issuer(env: &Env, issuer: &Address, pubkey: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::Issuer(issuer.clone()), pubkey);
}

pub fn get_issuer(env: &Env, issuer: &Address) -> Option<BytesN<32>> {
    env.storage()
        .persistent()
        .get(&DataKey::Issuer(issuer.clone()))
}

pub fn is_issuer(env: &Env, issuer: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Issuer(issuer.clone()))
}

pub fn remove_issuer(env: &Env, issuer: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Issuer(issuer.clone()));
}

pub fn get_issuer_nonce(env: &Env, issuer: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::IssuerNonce(issuer.clone()))
        .unwrap_or(0)
}

pub fn set_issuer_nonce(env: &Env, issuer: &Address, nonce: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::IssuerNonce(issuer.clone()), &nonce);
}

// ── Attestations ─────────────────────────────────────────────────────────────

pub fn set_attestation(env: &Env, attestation: &Attestation) {
    env.storage()
        .persistent()
        .set(&DataKey::Attestation(attestation.id), attestation);
}

pub fn get_attestation(env: &Env, id: u32) -> Result<Attestation, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Attestation(id))
        .ok_or(Error::ClaimNotFound)
}

pub fn get_attestation_opt(env: &Env, id: u32) -> Option<Attestation> {
    env.storage().persistent().get(&DataKey::Attestation(id))
}

// ── Owner → claims index ─────────────────────────────────────────────────────

pub fn get_owner_claims(env: &Env, owner: &Address) -> Vec<u32> {
    env.storage()
        .persistent()
        .get(&DataKey::OwnerClaims(owner.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_owner_claims(env: &Env, owner: &Address, claims: &Vec<u32>) {
    env.storage()
        .persistent()
        .set(&DataKey::OwnerClaims(owner.clone()), claims);
}

pub fn push_owner_claim(env: &Env, owner: &Address, id: u32) {
    let mut claims = get_owner_claims(env, owner);
    claims.push_back(id);
    set_owner_claims(env, owner, &claims);
}

/// Remove a single claim id from an owner's index. Missing ids are ignored.
pub fn remove_owner_claim(env: &Env, owner: &Address, id: u32) {
    let claims = get_owner_claims(env, owner);
    let mut out: Vec<u32> = Vec::new(env);
    for claim_id in claims.iter() {
        if claim_id != id {
            out.push_back(claim_id);
        }
    }
    set_owner_claims(env, owner, &out);
}

// ── Guardians ────────────────────────────────────────────────────────────────

pub fn get_guardians(env: &Env, owner: &Address) -> Vec<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::Guardians(owner.clone()))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_guardians(env: &Env, owner: &Address, guardians: &Vec<Address>) {
    env.storage()
        .persistent()
        .set(&DataKey::Guardians(owner.clone()), guardians);
}

pub fn get_guardian_threshold(env: &Env, owner: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::GuardianThreshold(owner.clone()))
        .unwrap_or(0)
}

pub fn set_guardian_threshold(env: &Env, owner: &Address, threshold: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::GuardianThreshold(owner.clone()), &threshold);
}

pub fn clear_guardians(env: &Env, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Guardians(owner.clone()));
    env.storage()
        .persistent()
        .remove(&DataKey::GuardianThreshold(owner.clone()));
}

// ── Recovery requests ────────────────────────────────────────────────────────

pub fn get_recovery(env: &Env, owner: &Address) -> Option<RecoveryRequest> {
    env.storage()
        .persistent()
        .get(&DataKey::Recovery(owner.clone()))
}

pub fn set_recovery(env: &Env, request: &RecoveryRequest) {
    env.storage()
        .persistent()
        .set(&DataKey::Recovery(request.owner.clone()), request);
}

pub fn remove_recovery(env: &Env, owner: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::Recovery(owner.clone()));
}
