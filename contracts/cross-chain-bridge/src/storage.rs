// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Bytes, Env};

use crate::types::{DataKey, Deposit, Error, InstanceKey, ValidatorKey, BridgeStats, ValidatorProof, ProofStatus};

// ── Admin ────────────────────────────────────────────────────────────────────

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

// ── Pause ────────────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::IsPaused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::IsPaused, &paused);
}

// ── Fee ──────────────────────────────────────────────────────────────────────

pub fn get_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::FeeBps)
        .unwrap_or(30) // default 0.3%
}

pub fn set_fee_bps(env: &Env, bps: u32) {
    env.storage().instance().set(&InstanceKey::FeeBps, &bps);
}

// ── Expiry ───────────────────────────────────────────────────────────────────

pub fn get_expiry_seconds(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::ExpirySeconds)
        .unwrap_or(86_400) // default 24 h
}

pub fn set_expiry_seconds(env: &Env, secs: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::ExpirySeconds, &secs);
}

// ── Daily limit ───────────────────────────────────────────────────────────────

pub fn get_daily_limit(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::DailyLimit)
        .unwrap_or(i128::MAX)
}

pub fn set_daily_limit(env: &Env, limit: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::DailyLimit, &limit);
}

pub fn get_daily_volume(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::DailyVolume)
        .unwrap_or(0)
}

pub fn get_daily_volume_ts(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::DailyVolumeTs)
        .unwrap_or(0)
}

/// Accumulate volume; resets if a new day has started (86400 s window).
pub fn accumulate_daily_volume(env: &Env, amount: i128) -> i128 {
    let now = env.ledger().timestamp();
    let last_ts = get_daily_volume_ts(env);
    let current = if now.saturating_sub(last_ts) >= 86_400 {
        0
    } else {
        get_daily_volume(env)
    };
    let new_vol = current.saturating_add(amount);
    env.storage()
        .instance()
        .set(&InstanceKey::DailyVolume, &new_vol);
    env.storage()
        .instance()
        .set(&InstanceKey::DailyVolumeTs, &now);
    new_vol
}

// ── Deposit counter ───────────────────────────────────────────────────────────

pub fn get_deposit_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::DepositCount)
        .unwrap_or(0)
}

pub fn set_deposit_count(env: &Env, count: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::DepositCount, &count);
}

// ── Deposit ───────────────────────────────────────────────────────────────────

pub fn set_deposit(env: &Env, id: u32, deposit: &Deposit) {
    env.storage()
        .persistent()
        .set(&DataKey::Deposit(id), deposit);
}

pub fn get_deposit(env: &Env, id: u32) -> Result<Deposit, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Deposit(id))
        .ok_or(Error::DepositNotFound)
}

// ── Relayer ───────────────────────────────────────────────────────────────────

pub fn set_relayer(env: &Env, relayer: &Address, active: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Relayer(relayer.clone()), &active);
}

pub fn is_relayer(env: &Env, relayer: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Relayer(relayer.clone()))
        .unwrap_or(false)
}

// ── Stats ─────────────────────────────────────────────────────────────────────

pub fn get_stats(env: &Env) -> BridgeStats {
    env.storage()
        .persistent()
        .get(&DataKey::Stats)
        .unwrap_or(BridgeStats {
            total_locked: 0,
            total_minted: 0,
            total_refunded: 0,
            deposit_count: 0,
            active_deposits: 0,
        })
}

pub fn set_stats(env: &Env, stats: &BridgeStats) {
    env.storage().persistent().set(&DataKey::Stats, stats);
}

// ── Validators ────────────────────────────────────────────────────────────────

pub fn set_validator(env: &Env, validator: &Address, active: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Validator(validator.clone()), &active);
}

pub fn is_validator(env: &Env, validator: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Validator(validator.clone()))
        .unwrap_or(false)
}

pub fn get_validator_quorum(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&ValidatorKey::Quorum)
        .unwrap_or(2)
}

pub fn set_validator_quorum(env: &Env, quorum: u32) {
    env.storage()
        .instance()
        .set(&ValidatorKey::Quorum, &quorum);
}

// ── Proof records ─────────────────────────────────────────────────────────────

pub fn get_proof(env: &Env, deposit_id: u32) -> Option<ValidatorProof> {
    env.storage()
        .persistent()
        .get(&DataKey::Proof(deposit_id))
}

pub fn set_proof(env: &Env, deposit_id: u32, proof: &ValidatorProof) {
    env.storage()
        .persistent()
        .set(&DataKey::Proof(deposit_id), proof);
}

pub fn has_validator_voted(env: &Env, deposit_id: u32, validator: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::ValidatorVote(deposit_id, validator.clone()))
        .unwrap_or(false)
}

pub fn record_validator_vote(env: &Env, deposit_id: u32, validator: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::ValidatorVote(deposit_id, validator.clone()), &true);
}

/// Submit a validator proof vote. Returns the updated proof record.
/// First voter sets the canonical hash; subsequent voters must match it.
/// Returns `Err` if the validator already voted, hash mismatches, or proof is finalized.
pub fn submit_validator_vote(
    env: &Env,
    deposit_id: u32,
    validator: &Address,
    proof_hash: &Bytes,
) -> Result<ValidatorProof, Error> {
    if has_validator_voted(env, deposit_id, validator) {
        return Err(Error::AlreadyVoted);
    }

    let mut proof = get_proof(env, deposit_id).unwrap_or(ValidatorProof {
        proof_hash: proof_hash.clone(),
        vote_count: 0,
        status: ProofStatus::Pending,
    });

    if proof.status == ProofStatus::Verified {
        return Err(Error::ProofAlreadyFinalized);
    }

    // All votes must be for the same hash (first submission wins).
    if proof.vote_count > 0 && proof.proof_hash != *proof_hash {
        return Err(Error::EmptyProofHash);
    }

    record_validator_vote(env, deposit_id, validator);
    proof.vote_count += 1;

    let quorum = get_validator_quorum(env);
    if proof.vote_count >= quorum {
        proof.status = ProofStatus::Verified;
    }

    set_proof(env, deposit_id, &proof);
    Ok(proof)
}
