// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # CCIP-style Cross-Chain Message Relay
//!
//! A Soroban-side message relay that lets contracts react to calls originating
//! on Ethereum, Solana or Cosmos. Implements the production readiness
//! requirements from issue #1378:
//!
//! 1. **Proof validation** — every message must present a SHA-256 Merkle proof
//!    resolving to the source chain's approved root. Leaves commit to the
//!    `(source chain, nonce, payload)` tuple, so a proof cannot be replayed for
//!    a different chain, nonce or payload.
//! 2. **Replay protection** — each `(source chain, nonce)` pair is processed at
//!    most once.
//! 3. **Dynamic gas refunds** — relayers are credited an XLM refund in stroops
//!    that scales with the payload gas and the admin-configured congestion
//!    multiplier, capped by `max_refund`.
//!
//! ## Lifecycle
//! 1. Admin calls [`CcipBridge::initialize`] with a gas price and refund cap.
//! 2. Admin registers relayers and source-chain Merkle roots.
//! 3. A relayer calls [`CcipBridge::execute_cross_chain_message`].
//! 4. The relayer calls [`CcipBridge::claim_refund`] to settle its XLM refund.

#![no_std]

mod storage;
#[cfg(test)]
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, Vec};

use crate::storage::{
    get_admin, get_base_refund, get_chain_config, get_congestion_bps, get_gas_price,
    get_max_refund, get_receipt, get_relayer_stats, get_total_claimed, get_total_refunded,
    is_initialized, is_nonce_processed, is_paused, is_relayer, mark_nonce_processed, set_admin,
    set_base_refund, set_chain_config, set_congestion_bps, set_gas_price, set_max_refund,
    set_paused, set_receipt, set_relayer, set_relayer_stats, set_total_claimed, set_total_refunded,
};
use crate::types::{ChainConfig, Error, MessageReceipt, RelayerStats};

/// Domain tag mixed into every Merkle leaf.
const LEAF_DOMAIN: &[u8] = b"CCIP1";
/// Fixed execution gas charged per delivered message.
const BASE_EXECUTION_GAS: i128 = 25_000;
/// Additional gas charged per payload byte.
const GAS_PER_PAYLOAD_BYTE: i128 = 16;
/// Maximum supported Merkle proof depth.
const MAX_PROOF_DEPTH: u32 = 32;
/// Basis-point denominator.
const BPS_DENOMINATOR: i128 = 10_000;
/// Largest allowed congestion multiplier (10x).
const MAX_CONGESTION_BPS: u32 = 100_000;

#[contract]
pub struct CcipBridge;

#[contractimpl]
impl CcipBridge {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the bridge. `gas_price` is in stroops per gas unit and
    /// `max_refund` caps the refund for a single delivery.
    pub fn initialize(
        env: Env,
        admin: Address,
        gas_price: i128,
        max_refund: i128,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if gas_price <= 0 {
            return Err(Error::InvalidGasPrice);
        }
        if max_refund < 0 {
            return Err(Error::InvalidRefundConfig);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_gas_price(&env, gas_price);
        set_max_refund(&env, max_refund);
        set_base_refund(&env, 0);
        set_congestion_bps(&env, 10_000);
        set_total_refunded(&env, 0);
        set_total_claimed(&env, 0);
        set_paused(&env, false);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    /// Pause or unpause message execution.
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_paused(&env, paused);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    /// Register or deregister a relayer.
    pub fn register_relayer(
        env: Env,
        admin: Address,
        relayer: Address,
        active: bool,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_relayer(&env, &relayer, active);
        env.events()
            .publish((symbol_short!("relayer"),), (relayer, active));
        Ok(())
    }

    pub fn is_relayer(env: Env, relayer: Address) -> bool {
        is_relayer(&env, &relayer)
    }

    /// Create or replace the configuration for a source chain.
    pub fn set_chain_config(
        env: Env,
        admin: Address,
        chain_id: u64,
        merkle_root: BytesN<32>,
        enabled: bool,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        let config = ChainConfig {
            chain_id,
            merkle_root,
            enabled,
            updated_at: env.ledger().timestamp(),
        };
        set_chain_config(&env, &config);
        env.events()
            .publish((symbol_short!("chain"),), (chain_id, enabled));
        Ok(())
    }

    /// Rotate the Merkle root of an existing chain configuration.
    pub fn set_merkle_root(
        env: Env,
        admin: Address,
        chain_id: u64,
        merkle_root: BytesN<32>,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        let mut config = get_chain_config(&env, chain_id).ok_or(Error::ChainNotConfigured)?;
        config.merkle_root = merkle_root;
        config.updated_at = env.ledger().timestamp();
        set_chain_config(&env, &config);
        env.events().publish((symbol_short!("root"),), chain_id);
        Ok(())
    }

    /// Update the XLM gas price used for refunds (stroops per gas unit).
    pub fn set_gas_price(env: Env, admin: Address, gas_price: i128) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if gas_price <= 0 {
            return Err(Error::InvalidGasPrice);
        }
        set_gas_price(&env, gas_price);
        Ok(())
    }

    /// Update the flat base refund added to every delivery.
    pub fn set_base_refund(env: Env, admin: Address, base_refund: i128) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if base_refund < 0 {
            return Err(Error::InvalidRefundConfig);
        }
        set_base_refund(&env, base_refund);
        Ok(())
    }

    /// Update the maximum refund payable for a single delivery.
    pub fn set_max_refund(env: Env, admin: Address, max_refund: i128) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if max_refund < 0 {
            return Err(Error::InvalidRefundConfig);
        }
        set_max_refund(&env, max_refund);
        Ok(())
    }

    /// Update the congestion multiplier in basis points (`10_000` = 1x).
    pub fn set_congestion_bps(env: Env, admin: Address, bps: u32) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if bps > MAX_CONGESTION_BPS {
            return Err(Error::InvalidCongestion);
        }
        set_congestion_bps(&env, bps);
        Ok(())
    }

    pub fn get_gas_price(env: Env) -> i128 {
        get_gas_price(&env)
    }

    pub fn get_base_refund(env: Env) -> i128 {
        get_base_refund(&env)
    }

    pub fn get_max_refund(env: Env) -> i128 {
        get_max_refund(&env)
    }

    pub fn get_congestion_bps(env: Env) -> u32 {
        get_congestion_bps(&env)
    }

    // ── Message execution ─────────────────────────────────────────────────────

    /// Execute a cross-chain message after validating its Merkle proof.
    ///
    /// Returns the XLM gas refund credited to the relayer. The relayer must be
    /// registered, the source chain enabled, and the `(source_chain_id, nonce)`
    /// pair not previously processed.
    pub fn execute_cross_chain_message(
        env: Env,
        relayer: Address,
        source_chain_id: u64,
        nonce: u64,
        message_payload: Bytes,
        merkle_proof: Vec<BytesN<32>>,
    ) -> Result<i128, Error> {
        assert_initialized(&env)?;
        if is_paused(&env) {
            return Err(Error::BridgePaused);
        }
        relayer.require_auth();

        if !is_relayer(&env, &relayer) {
            return Err(Error::UnknownRelayer);
        }
        if message_payload.is_empty() {
            return Err(Error::EmptyPayload);
        }
        if merkle_proof.len() > MAX_PROOF_DEPTH {
            return Err(Error::ProofTooDeep);
        }

        let config = get_chain_config(&env, source_chain_id).ok_or(Error::ChainNotConfigured)?;
        if !config.enabled {
            return Err(Error::ChainDisabled);
        }

        // Replay protection: a message nonce is consumed exactly once per chain.
        if is_nonce_processed(&env, source_chain_id, nonce) {
            return Err(Error::NonceAlreadyProcessed);
        }

        let leaf = leaf_hash(&env, source_chain_id, nonce, &message_payload);
        if !verify_merkle(&env, &config.merkle_root, &leaf, &merkle_proof) {
            return Err(Error::MerkleProofInvalid);
        }

        mark_nonce_processed(&env, source_chain_id, nonce);

        let refund = compute_refund(&env, message_payload.len())?;
        let payload_hash = env.crypto().sha256(&message_payload).into();
        let receipt = MessageReceipt {
            source_chain_id,
            nonce,
            payload_hash,
            relayer: relayer.clone(),
            executed_at: env.ledger().timestamp(),
            refund,
        };
        set_receipt(&env, &receipt);

        let mut stats = get_relayer_stats(&env, &relayer);
        stats.deliveries = stats
            .deliveries
            .checked_add(1)
            .ok_or(Error::ArithmeticOverflow)?;
        stats.total_refunded = stats
            .total_refunded
            .checked_add(refund)
            .ok_or(Error::ArithmeticOverflow)?;
        stats.claimable = stats
            .claimable
            .checked_add(refund)
            .ok_or(Error::ArithmeticOverflow)?;
        set_relayer_stats(&env, &relayer, &stats);

        let total_refunded = get_total_refunded(&env)
            .checked_add(refund)
            .ok_or(Error::ArithmeticOverflow)?;
        set_total_refunded(&env, total_refunded);

        env.events().publish(
            (symbol_short!("executed"), source_chain_id, nonce),
            (relayer, refund),
        );
        Ok(refund)
    }

    /// Claim all XLM refunds credited to the relayer.
    pub fn claim_refund(env: Env, relayer: Address) -> Result<i128, Error> {
        assert_initialized(&env)?;
        relayer.require_auth();

        if !is_relayer(&env, &relayer) {
            return Err(Error::UnknownRelayer);
        }

        let mut stats = get_relayer_stats(&env, &relayer);
        let amount = stats.claimable;
        if amount <= 0 {
            return Err(Error::NoRefund);
        }

        stats.claimable = 0;
        stats.claimed = stats
            .claimed
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        set_relayer_stats(&env, &relayer, &stats);

        let total_claimed = get_total_claimed(&env)
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        set_total_claimed(&env, total_claimed);

        env.events()
            .publish((symbol_short!("claimed"),), (relayer, amount));
        Ok(amount)
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    pub fn get_chain_config(env: Env, chain_id: u64) -> Option<ChainConfig> {
        get_chain_config(&env, chain_id)
    }

    pub fn is_nonce_processed(env: Env, chain_id: u64, nonce: u64) -> bool {
        is_nonce_processed(&env, chain_id, nonce)
    }

    pub fn get_receipt(env: Env, chain_id: u64, nonce: u64) -> Option<MessageReceipt> {
        get_receipt(&env, chain_id, nonce)
    }

    pub fn get_relayer_stats(env: Env, relayer: Address) -> RelayerStats {
        get_relayer_stats(&env, &relayer)
    }

    pub fn get_claimable_refund(env: Env, relayer: Address) -> i128 {
        get_relayer_stats(&env, &relayer).claimable
    }

    pub fn total_refunded(env: Env) -> i128 {
        get_total_refunded(&env)
    }

    pub fn total_claimed(env: Env) -> i128 {
        get_total_claimed(&env)
    }

    /// Deterministic Merkle leaf for a message:
    /// `sha256(b"CCIP1" || chain_id_be || nonce_be || payload)`.
    pub fn compute_leaf(env: Env, source_chain_id: u64, nonce: u64, payload: Bytes) -> BytesN<32> {
        leaf_hash(&env, source_chain_id, nonce, &payload)
    }

    /// Commutative SHA-256 pair hashing, exposed so clients can build and audit
    /// Merkle trees exactly as the contract verifies them.
    pub fn hash_pair(env: Env, a: BytesN<32>, b: BytesN<32>) -> BytesN<32> {
        pair_hash(&env, &a, &b)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn assert_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    assert_initialized(env)?;
    caller.require_auth();
    let admin = get_admin(env)?;
    if *caller != admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn leaf_hash(env: &Env, chain_id: u64, nonce: u64, payload: &Bytes) -> BytesN<32> {
    let mut preimage = Bytes::from_slice(env, LEAF_DOMAIN);
    preimage.append(&Bytes::from_array(env, &chain_id.to_be_bytes()));
    preimage.append(&Bytes::from_array(env, &nonce.to_be_bytes()));
    preimage.append(payload);
    env.crypto().sha256(&preimage).into()
}

/// Commutative `sha256(min(a,b) || max(a,b))`, matching OpenZeppelin-style
/// Merkle trees.
fn pair_hash(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let left = a.to_array();
    let right = b.to_array();
    let (first, second) = if left <= right {
        (left, right)
    } else {
        (right, left)
    };
    let mut buffer = Bytes::new(env);
    buffer.append(&Bytes::from_array(env, &first));
    buffer.append(&Bytes::from_array(env, &second));
    env.crypto().sha256(&buffer).into()
}

/// Verify `leaf` against `root` given an ordered sibling proof.
fn verify_merkle(env: &Env, root: &BytesN<32>, leaf: &BytesN<32>, proof: &Vec<BytesN<32>>) -> bool {
    let mut computed = leaf.clone();
    for sibling in proof.iter() {
        computed = pair_hash(env, &computed, &sibling);
    }
    computed.to_array() == root.to_array()
}

/// Dynamic XLM refund:
/// `(base_gas + bytes * gas_per_byte) * gas_price * congestion / 10000 + base`,
/// capped at `max_refund`.
fn compute_refund(env: &Env, payload_len: u32) -> Result<i128, Error> {
    let gas_units = BASE_EXECUTION_GAS
        .checked_add(
            (payload_len as i128)
                .checked_mul(GAS_PER_PAYLOAD_BYTE)
                .ok_or(Error::ArithmeticOverflow)?,
        )
        .ok_or(Error::ArithmeticOverflow)?;

    let gross = gas_units
        .checked_mul(get_gas_price(env))
        .ok_or(Error::ArithmeticOverflow)?;
    let scaled = gross
        .checked_mul(get_congestion_bps(env) as i128)
        .ok_or(Error::ArithmeticOverflow)?
        / BPS_DENOMINATOR;
    let with_base = scaled
        .checked_add(get_base_refund(env))
        .ok_or(Error::ArithmeticOverflow)?;

    let max_refund = get_max_refund(env);
    Ok(if with_base > max_refund {
        max_refund
    } else {
        with_base
    })
}
