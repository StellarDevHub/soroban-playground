// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, BytesN};

/// Errors returned by the CCIP bridge contract.
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
    /// Relayer address is not registered.
    UnknownRelayer = 4,
    /// Source chain has no Merkle root configured.
    ChainNotConfigured = 5,
    /// Source chain is currently disabled.
    ChainDisabled = 6,
    /// Bridge is paused.
    BridgePaused = 7,
    /// Merkle proof exceeds the maximum supported depth.
    ProofTooDeep = 8,
    /// Merkle proof does not resolve to the configured root.
    MerkleProofInvalid = 9,
    /// Message nonce was already processed for this source chain.
    NonceAlreadyProcessed = 10,
    /// Message payload must not be empty.
    EmptyPayload = 11,
    /// Gas price must be greater than zero.
    InvalidGasPrice = 12,
    /// Refund configuration is out of range.
    InvalidRefundConfig = 13,
    /// Congestion multiplier is out of range.
    InvalidCongestion = 14,
    /// Relayer has no refund available to claim.
    NoRefund = 15,
    /// Arithmetic overflow or underflow occurred.
    ArithmeticOverflow = 16,
}

/// Configuration for one supported source chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ChainConfig {
    /// Source chain identifier (e.g. Ethereum mainnet = 1).
    pub chain_id: u64,
    /// Current approved Merkle root for message batches from this chain.
    pub merkle_root: BytesN<32>,
    /// Whether messages from this chain are currently accepted.
    pub enabled: bool,
    /// Ledger timestamp of the last root/config update.
    pub updated_at: u64,
}

/// Proof that a cross-chain message was executed.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MessageReceipt {
    /// Source chain the message came from.
    pub source_chain_id: u64,
    /// Per-chain message nonce.
    pub nonce: u64,
    /// `sha256(payload)` of the relayed message.
    pub payload_hash: BytesN<32>,
    /// Relayer that executed the message.
    pub relayer: Address,
    /// Ledger timestamp of execution.
    pub executed_at: u64,
    /// XLM gas refund credited to the relayer (in stroops).
    pub refund: i128,
}

/// Per-relayer delivery and refund accounting.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RelayerStats {
    /// Number of messages successfully relayed.
    pub deliveries: u64,
    /// Total refunds ever credited (including claimed).
    pub total_refunded: i128,
    /// Refund currently claimable by the relayer.
    pub claimable: i128,
    /// Refund already claimed by the relayer.
    pub claimed: i128,
}

/// Instance storage keys.
#[contracttype]
pub enum InstanceKey {
    /// Contract admin address.
    Admin,
    /// Refund gas price in stroops per gas unit.
    GasPrice,
    /// Flat additional refund added to every delivery.
    BaseRefund,
    /// Maximum refund payable for a single delivery.
    MaxRefund,
    /// Congestion multiplier in basis points (10_000 = 1x).
    CongestionBps,
    /// Aggregate refunds credited across all relayers.
    TotalRefunded,
    /// Aggregate refunds claimed across all relayers.
    TotalClaimed,
    /// Emergency pause flag.
    Paused,
}

/// Persistent data keys.
#[contracttype]
pub enum DataKey {
    /// Chain configuration by source chain id.
    Chain(u64),
    /// Executed message receipt by (source chain, nonce).
    Receipt(u64, u64),
    /// Whether a relayer is registered/active.
    Relayer(Address),
    /// Delivery + refund accounting for a relayer.
    RelayerStats(Address),
    /// Replay-protection marker for a (source chain, nonce) pair.
    Processed(u64, u64),
}
