// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Multisig Wallet
//!
//! A production-ready multi-signature wallet contract for decentralized
//! governance on Soroban. It enables M-of-N approval over arbitrary
//! operations with optional time-locked execution.
//!
//! ## Features
//! - Configurable M-of-N approval threshold.
//! - Time-locked execution (`min_delay` / `max_delay` window).
//! - Queued transactions with cancellation and confirmation revocation.
//! - Strict owner & threshold invariants.
//! - Standard event emission: `Submission`, `Confirmation`, `Revocation`,
//!   `Execution`, `Cancellation`, `OwnerAddition`, `OwnerRemoval`,
//!   `ThresholdChange`, `DelayChange`.
//!
//! ## Lifecycle
//! 1. Deploy + call `initialize` with the initial owners, threshold, and
//!    delay window.
//! 2. Owners call `submit_transaction` to queue an operation.
//! 3. Distinct owners call `confirm_transaction` until the threshold is met.
//! 4. After `min_delay` has elapsed, any owner calls `execute_transaction`.
//! 5. `cancel_transaction` or `revoke_confirmation` can abort the flow.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, String, Vec};

use crate::storage::{
    get_max_delay, get_min_delay, get_owner_at, get_owner_count, get_owner_nonce, get_owner_pubkey,
    get_owner_weight, get_threshold, get_tx, get_tx_count, has_owner, is_confirmed, is_initialized,
    record_confirmation, remove_confirmation, remove_is_owner, remove_owner_at, remove_owner_nonce,
    remove_owner_pubkey, remove_owner_weight, set_initialized, set_is_owner, set_max_delay,
    set_min_delay, set_owner_at, set_owner_count, set_owner_nonce, set_owner_pubkey,
    set_owner_weight, set_threshold, set_tx, set_tx_count,
};
use crate::types::{Error, Transaction, TxStatus};

// ── Contract entry point ──────────────────────────────────────────────────────

#[contract]
pub struct MultisigWallet;

#[contractimpl]
impl MultisigWallet {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the wallet with `owners`, an approval `threshold`, and a
    /// delay window `[min_delay, max_delay]` (seconds). Must be called once.
    pub fn initialize(
        env: Env,
        owners: Vec<Address>,
        threshold: u32,
        min_delay: u64,
        max_delay: u64,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if owners.is_empty() {
            return Err(Error::OwnerRequired);
        }
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        if threshold > owners.len() {
            return Err(Error::InvalidThreshold);
        }
        if min_delay > max_delay {
            return Err(Error::InvalidDelay);
        }

        // Deduplicate owners.
        let mut seen: Vec<Address> = Vec::new(&env);
        for owner in owners.iter() {
            if seen.contains(&owner) {
                return Err(Error::DuplicateOwner);
            }
            seen.push_back(owner.clone());
        }

        // Persist owners.
        set_owner_count(&env, seen.len());
        for (i, owner) in seen.iter().enumerate() {
            set_owner_at(&env, i as u32, &owner);
            set_is_owner(&env, &owner);
        }

        set_threshold(&env, threshold);
        set_min_delay(&env, min_delay);
        set_max_delay(&env, max_delay);
        set_tx_count(&env, 0);
        set_initialized(&env);

        env.events()
            .publish((symbol_short!("Init"),), (threshold, min_delay, max_delay));
        Ok(())
    }

    // ── Owner management ─────────────────────────────────────────────────────

    /// Add a new owner. Only callable by an existing owner.
    pub fn add_owner(env: Env, caller: Address, new_owner: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        if has_owner(&env, &new_owner) {
            return Err(Error::OwnerExists);
        }

        let count = get_owner_count(&env);
        set_owner_at(&env, count, &new_owner);
        set_is_owner(&env, &new_owner);
        set_owner_count(&env, count + 1);

        env.events()
            .publish((symbol_short!("OwnerAdd"),), (caller, new_owner));
        Ok(())
    }

    /// Remove an owner. Only callable by an existing owner. The remaining
    /// owner count must still satisfy the current threshold.
    pub fn remove_owner(env: Env, caller: Address, owner: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        if !has_owner(&env, &owner) {
            return Err(Error::OwnerNotFound);
        }
        if caller == owner {
            return Err(Error::SelfRemoval);
        }

        let count = get_owner_count(&env);
        if count - 1 < get_threshold(&env) {
            return Err(Error::InvalidThreshold);
        }

        // Find owner's index and swap with last.
        let mut idx: Option<u32> = None;
        for i in 0..count {
            if let Some(cur) = get_owner_at(&env, i) {
                if cur == owner {
                    idx = Some(i);
                    break;
                }
            }
        }
        if let Some(i) = idx {
            let last_idx = count - 1;
            if i != last_idx {
                if let Some(last) = get_owner_at(&env, last_idx) {
                    set_owner_at(&env, i, &last);
                }
            }
            remove_owner_at(&env, last_idx);
        }
        remove_is_owner(&env, &owner);
        remove_owner_weight(&env, &owner);
        remove_owner_pubkey(&env, &owner);
        remove_owner_nonce(&env, &owner);
        set_owner_count(&env, count - 1);

        env.events()
            .publish((symbol_short!("OwnerRem"),), (caller, owner));
        Ok(())
    }

    /// Replace the approval threshold. Must be in `[1, owner_count]`.
    pub fn change_threshold(env: Env, caller: Address, new_threshold: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        if new_threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        let count = get_owner_count(&env);
        if new_threshold > count {
            return Err(Error::InvalidThreshold);
        }
        set_threshold(&env, new_threshold);
        env.events()
            .publish((symbol_short!("ThreshChg"),), (caller, new_threshold));
        Ok(())
    }

    /// Update the delay window. Only callable by an existing owner.
    pub fn update_delays(
        env: Env,
        caller: Address,
        min_delay: u64,
        max_delay: u64,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        if min_delay > max_delay {
            return Err(Error::InvalidDelay);
        }
        set_min_delay(&env, min_delay);
        set_max_delay(&env, max_delay);
        env.events()
            .publish((symbol_short!("DelayChg"),), (caller, min_delay, max_delay));
        Ok(())
    }

    // ── Weight-based signers ─────────────────────────────────────────────────

    /// Set an owner's voting weight. Only callable by an existing owner.
    /// Weights default to 1, so wallets configured before weights existed
    /// behave exactly as before. Weight must be at least 1.
    pub fn set_owner_weight(
        env: Env,
        caller: Address,
        owner: Address,
        weight: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_owner(&env, &owner)?;

        if weight == 0 {
            return Err(Error::InvalidWeight);
        }
        set_owner_weight(&env, &owner, weight);
        env.events()
            .publish((symbol_short!("WeightChg"),), (caller, owner, weight));
        Ok(())
    }

    /// Voting weight of an owner (1 when never set).
    pub fn get_owner_weight(env: Env, owner: Address) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        require_owner(&env, &owner)?;
        Ok(get_owner_weight(&env, &owner))
    }

    /// Register an owner's ed25519 public key for off-chain signature
    /// confirmations. Only callable by an existing owner.
    pub fn set_owner_pubkey(
        env: Env,
        caller: Address,
        owner: Address,
        pubkey: BytesN<32>,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;
        require_owner(&env, &owner)?;

        set_owner_pubkey(&env, &owner, &pubkey);
        env.events()
            .publish((symbol_short!("PubkeyReg"),), (caller, owner));
        Ok(())
    }

    // ── Transaction lifecycle ────────────────────────────────────────────────

    /// Submit a new transaction for approval. `delay` is the number of
    /// seconds that must elapse after the threshold is reached before the
    /// transaction can be executed. Must satisfy
    /// `min_delay <= delay <= max_delay`.
    pub fn submit_transaction(
        env: Env,
        proposer: Address,
        target: Address,
        value: i128,
        data: String,
        delay: u64,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        proposer.require_auth();
        require_owner(&env, &proposer)?;

        if value < 0 {
            return Err(Error::InvalidValue);
        }
        if data.is_empty() {
            return Err(Error::EmptyData);
        }
        if data.len() > MAX_DATA_LENGTH {
            return Err(Error::DataTooLong);
        }
        if delay < get_min_delay(&env) || delay > get_max_delay(&env) {
            return Err(Error::InvalidDelay);
        }

        let now = env.ledger().timestamp();
        let id = get_tx_count(&env);
        let tx = Transaction {
            id,
            proposer: proposer.clone(),
            target: target.clone(),
            value,
            data: data.clone(),
            status: TxStatus::Pending,
            confirmations: 0,
            confirmation_weight: 0,
            created_at: now,
            delay,
            execute_after: 0,
        };
        set_tx(&env, &tx);
        set_tx_count(&env, id + 1);

        env.events()
            .publish((symbol_short!("Submit"),), (id, proposer));
        Ok(id)
    }

    /// Confirm a pending transaction. The caller must be an owner and must
    /// not have already confirmed the transaction. The owner's weight is
    /// added to the confirmation weight; when it reaches the threshold the
    /// transaction becomes `Ready` and its `execute_after` is set to
    /// `now + delay`.
    pub fn confirm_transaction(env: Env, owner: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();
        require_owner(&env, &owner)?;

        let mut tx = get_tx(&env, tx_id)?;
        if tx.status != TxStatus::Pending {
            return Err(Error::WrongStatus);
        }
        if is_confirmed(&env, tx_id, &owner) {
            return Err(Error::AlreadyConfirmed);
        }

        record_confirmation(&env, tx_id, &owner);
        tx.confirmations += 1;
        tx.confirmation_weight += get_owner_weight(&env, &owner) as u64;

        if tx.confirmation_weight >= get_threshold(&env) as u64 {
            tx.status = TxStatus::Ready;
            tx.execute_after = env.ledger().timestamp() + tx.delay;
        }
        set_tx(&env, &tx);

        env.events()
            .publish((symbol_short!("Confirm"),), (tx_id, owner));
        Ok(())
    }

    /// Revoke a previously-submitted confirmation. Only allowed while the
    /// transaction is still `Pending` or `Ready`. After revocation, if the
    /// transaction was `Ready` and confirmations drop below the threshold
    /// it returns to `Pending` and `execute_after` is reset.
    pub fn revoke_confirmation(env: Env, owner: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();
        require_owner(&env, &owner)?;

        let mut tx = get_tx(&env, tx_id)?;
        if tx.status != TxStatus::Pending && tx.status != TxStatus::Ready {
            return Err(Error::WrongStatus);
        }
        if !is_confirmed(&env, tx_id, &owner) {
            return Err(Error::NotConfirmed);
        }

        remove_confirmation(&env, tx_id, &owner);
        tx.confirmations -= 1;
        // Saturating: the owner's weight may have been lowered after they
        // confirmed, and revocation must never trap on underflow.
        tx.confirmation_weight = tx
            .confirmation_weight
            .saturating_sub(get_owner_weight(&env, &owner) as u64);

        if tx.status == TxStatus::Ready && tx.confirmation_weight < get_threshold(&env) as u64 {
            tx.status = TxStatus::Pending;
            tx.execute_after = 0;
        }
        set_tx(&env, &tx);

        env.events()
            .publish((symbol_short!("Revoke"),), (tx_id, owner));
        Ok(())
    }

    /// Execute a `Ready` transaction whose delay has elapsed. Marks the
    /// transaction `Executed`. The transfer of `value` to `target` is the
    /// responsibility of the inheriting integration; this contract enforces
    /// the governance path.
    pub fn execute_transaction(env: Env, caller: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        let mut tx = get_tx(&env, tx_id)?;
        if tx.status != TxStatus::Ready {
            return Err(Error::WrongStatus);
        }
        if env.ledger().timestamp() < tx.execute_after {
            return Err(Error::DelayNotElapsed);
        }

        tx.status = TxStatus::Executed;
        set_tx(&env, &tx);

        env.events()
            .publish((symbol_short!("Execute"),), (tx_id, caller));
        Ok(())
    }

    /// Cancel a transaction. Caller must be the proposer or any owner.
    /// Cancellation is only allowed while the transaction is not yet
    /// `Executed` or `Cancelled`.
    pub fn cancel_transaction(env: Env, caller: Address, tx_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        let mut tx = get_tx(&env, tx_id)?;
        if tx.status == TxStatus::Executed || tx.status == TxStatus::Cancelled {
            return Err(Error::WrongStatus);
        }
        // Proposer can cancel even if the proposer is the caller.
        // (caller.require_auth + require_owner already enforced above.)

        tx.status = TxStatus::Cancelled;
        set_tx(&env, &tx);

        env.events()
            .publish((symbol_short!("Cancel"),), (tx_id, caller));
        Ok(())
    }

    // ── Off-chain signature confirmations ────────────────────────────────────

    /// Confirm a pending transaction with an off-chain ed25519 signature
    /// instead of an on-chain authorization.
    ///
    /// The owner signs `b"MSIG1" || pubkey || tx_id_be || nonce_be` with the
    /// key registered via [`Self::set_owner_pubkey`]. Anyone (typically an
    /// aggregator) can submit collected signatures; each consumes the
    /// owner's current nonce, so a captured signature can never be replayed.
    /// Weight accounting matches [`Self::confirm_transaction`].
    ///
    /// Like `require_auth`, an invalid signature traps rather than returning
    /// an error.
    pub fn confirm_with_signature(
        env: Env,
        owner: Address,
        tx_id: u32,
        nonce: u64,
        signature: BytesN<64>,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        require_owner(&env, &owner)?;

        let mut tx = get_tx(&env, tx_id)?;
        if tx.status != TxStatus::Pending {
            return Err(Error::WrongStatus);
        }
        if is_confirmed(&env, tx_id, &owner) {
            return Err(Error::AlreadyConfirmed);
        }
        if nonce != get_owner_nonce(&env, &owner) {
            return Err(Error::InvalidNonce);
        }
        let pubkey = get_owner_pubkey(&env, &owner).ok_or(Error::MissingPubkey)?;

        let mut payload = Bytes::from_slice(&env, b"MSIG1");
        payload.append(&Bytes::from_array(&env, &pubkey.to_array()));
        payload.append(&Bytes::from_array(&env, &tx_id.to_be_bytes()));
        payload.append(&Bytes::from_array(&env, &nonce.to_be_bytes()));
        env.crypto().ed25519_verify(&pubkey, &payload, &signature);

        set_owner_nonce(&env, &owner, nonce + 1);
        record_confirmation(&env, tx_id, &owner);
        tx.confirmations += 1;
        tx.confirmation_weight += get_owner_weight(&env, &owner) as u64;

        if tx.confirmation_weight >= get_threshold(&env) as u64 {
            tx.status = TxStatus::Ready;
            tx.execute_after = env.ledger().timestamp() + tx.delay;
        }
        set_tx(&env, &tx);

        env.events()
            .publish((symbol_short!("SigConf"),), (tx_id, owner));
        Ok(())
    }

    /// Current off-chain signature nonce of an owner.
    pub fn get_owner_nonce(env: Env, owner: Address) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        require_owner(&env, &owner)?;
        Ok(get_owner_nonce(&env, &owner))
    }

    // ── Batch execution ──────────────────────────────────────────────────────

    /// Execute several `Ready` transactions whose delays have elapsed.
    /// All-or-nothing: every id is validated before anything executes, so a
    /// single unready transaction fails the whole batch without partial
    /// effects. Returns the executed ids in order.
    pub fn execute_batch(env: Env, caller: Address, tx_ids: Vec<u32>) -> Result<Vec<u32>, Error> {
        ensure_initialized(&env)?;
        caller.require_auth();
        require_owner(&env, &caller)?;

        let now = env.ledger().timestamp();
        for tx_id in tx_ids.iter() {
            let tx = get_tx(&env, tx_id)?;
            if tx.status != TxStatus::Ready {
                return Err(Error::WrongStatus);
            }
            if now < tx.execute_after {
                return Err(Error::DelayNotElapsed);
            }
        }

        let mut executed: Vec<u32> = Vec::new(&env);
        for tx_id in tx_ids.iter() {
            let mut tx = get_tx(&env, tx_id)?;
            tx.status = TxStatus::Executed;
            set_tx(&env, &tx);
            env.events()
                .publish((symbol_short!("Execute"),), (tx_id, caller.clone()));
            executed.push_back(tx_id);
        }
        Ok(executed)
    }

    // ── Read-only queries ────────────────────────────────────────────────────

    pub fn get_owners(env: Env) -> Result<Vec<Address>, Error> {
        ensure_initialized(&env)?;
        let count = get_owner_count(&env);
        let mut out: Vec<Address> = Vec::new(&env);
        for i in 0..count {
            if let Some(a) = get_owner_at(&env, i) {
                out.push_back(a);
            }
        }
        Ok(out)
    }

    pub fn get_owner_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_owner_count(&env))
    }

    pub fn is_owner(env: Env, addr: Address) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(has_owner(&env, &addr))
    }

    pub fn get_threshold(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_threshold(&env))
    }

    pub fn get_min_delay(env: Env) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(get_min_delay(&env))
    }

    pub fn get_max_delay(env: Env) -> Result<u64, Error> {
        ensure_initialized(&env)?;
        Ok(get_max_delay(&env))
    }

    pub fn get_transaction(env: Env, tx_id: u32) -> Result<Transaction, Error> {
        ensure_initialized(&env)?;
        get_tx(&env, tx_id)
    }

    pub fn get_transaction_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_tx_count(&env))
    }

    pub fn is_confirmed(env: Env, tx_id: u32, owner: Address) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        Ok(is_confirmed(&env, tx_id, &owner))
    }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_DATA_LENGTH: u32 = 256;

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_owner(env: &Env, addr: &Address) -> Result<(), Error> {
    if !has_owner(env, addr) {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
