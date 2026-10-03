// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{ChainConfig, DataKey, Error, InstanceKey, MessageReceipt, RelayerStats};

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

// ── Pause ────────────────────────────────────────────────────────────────────

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

// ── Refund configuration ─────────────────────────────────────────────────────

pub fn get_gas_price(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::GasPrice)
        .unwrap_or(100)
}

pub fn set_gas_price(env: &Env, gas_price: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::GasPrice, &gas_price);
}

pub fn get_base_refund(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::BaseRefund)
        .unwrap_or(0)
}

pub fn set_base_refund(env: &Env, base_refund: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::BaseRefund, &base_refund);
}

pub fn get_max_refund(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::MaxRefund)
        .unwrap_or(i128::MAX)
}

pub fn set_max_refund(env: &Env, max_refund: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::MaxRefund, &max_refund);
}

pub fn get_congestion_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::CongestionBps)
        .unwrap_or(10_000)
}

pub fn set_congestion_bps(env: &Env, bps: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::CongestionBps, &bps);
}

pub fn get_total_refunded(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalRefunded)
        .unwrap_or(0)
}

pub fn set_total_refunded(env: &Env, total: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::TotalRefunded, &total);
}

pub fn get_total_claimed(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalClaimed)
        .unwrap_or(0)
}

pub fn set_total_claimed(env: &Env, total: i128) {
    env.storage()
        .instance()
        .set(&InstanceKey::TotalClaimed, &total);
}

// ── Relayers ─────────────────────────────────────────────────────────────────

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

pub fn get_relayer_stats(env: &Env, relayer: &Address) -> RelayerStats {
    env.storage()
        .persistent()
        .get(&DataKey::RelayerStats(relayer.clone()))
        .unwrap_or(RelayerStats {
            deliveries: 0,
            total_refunded: 0,
            claimable: 0,
            claimed: 0,
        })
}

pub fn set_relayer_stats(env: &Env, relayer: &Address, stats: &RelayerStats) {
    env.storage()
        .persistent()
        .set(&DataKey::RelayerStats(relayer.clone()), stats);
}

// ── Chain configuration ──────────────────────────────────────────────────────

pub fn get_chain_config(env: &Env, chain_id: u64) -> Option<ChainConfig> {
    env.storage().persistent().get(&DataKey::Chain(chain_id))
}

pub fn set_chain_config(env: &Env, config: &ChainConfig) {
    env.storage()
        .persistent()
        .set(&DataKey::Chain(config.chain_id), config);
}

// ── Replay protection ────────────────────────────────────────────────────────

pub fn is_nonce_processed(env: &Env, chain_id: u64, nonce: u64) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Processed(chain_id, nonce))
}

pub fn mark_nonce_processed(env: &Env, chain_id: u64, nonce: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::Processed(chain_id, nonce), &true);
}

// ── Message receipts ─────────────────────────────────────────────────────────

pub fn get_receipt(env: &Env, chain_id: u64, nonce: u64) -> Option<MessageReceipt> {
    env.storage()
        .persistent()
        .get(&DataKey::Receipt(chain_id, nonce))
}

pub fn set_receipt(env: &Env, receipt: &MessageReceipt) {
    env.storage().persistent().set(
        &DataKey::Receipt(receipt.source_chain_id, receipt.nonce),
        receipt,
    );
}
