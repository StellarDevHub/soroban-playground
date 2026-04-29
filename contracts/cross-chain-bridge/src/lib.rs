// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Cross-Chain Bridge (Lock-Mint)
//!
//! Stellar-side of a Stellar ↔ Ethereum bridge:
//! - Users lock tokens on Stellar; a trusted relayer confirms the ETH mint.
//! - If the relayer never confirms, the depositor can reclaim after expiry.
//! - Admin controls: pause, fee, expiry window, daily volume cap, relayer set.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, Env, String};

use crate::storage::{
    accumulate_daily_volume, get_admin, get_daily_limit, get_deposit, get_deposit_count,
    get_expiry_seconds, get_fee_bps, get_stats, is_initialized, is_paused, is_relayer,
    set_admin, set_deposit, set_deposit_count, set_expiry_seconds, set_fee_bps,
    set_daily_limit, set_paused, set_relayer, set_stats,
};
use crate::types::{Deposit, DepositStatus, Error, BridgeStats};

const MAX_FEE_BPS: u32 = 1_000; // 10 %

#[contract]
pub struct BridgeContract;

#[contractimpl]
impl BridgeContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the bridge with an admin, fee (bps), expiry window and daily cap.
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_bps: u32,
        expiry_seconds: u64,
        daily_limit: i128,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_fee_bps(&env, fee_bps);
        set_expiry_seconds(&env, expiry_seconds);
        set_daily_limit(&env, daily_limit);
        set_paused(&env, false);
        set_deposit_count(&env, 0);
        Ok(())
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    /// Pause or unpause the bridge.
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, paused);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    /// Update the bridge fee in basis points (max 10%).
    pub fn set_fee(env: Env, admin: Address, fee_bps: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        set_fee_bps(&env, fee_bps);
        Ok(())
    }

    /// Update the deposit expiry window in seconds.
    pub fn set_expiry(env: Env, admin: Address, expiry_seconds: u64) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_expiry_seconds(&env, expiry_seconds);
        Ok(())
    }

    /// Update the daily volume cap (in stroops).
    pub fn set_daily_limit(env: Env, admin: Address, limit: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_daily_limit(&env, limit);
        Ok(())
    }

    /// Register or deregister a relayer address.
    pub fn set_relayer(env: Env, admin: Address, relayer: Address, active: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_relayer(&env, &relayer, active);
        env.events()
            .publish((symbol_short!("relayer"),), (relayer, active));
        Ok(())
    }

    // ── User actions ──────────────────────────────────────────────────────────

    /// Lock `amount` of `token` on Stellar for bridging to `eth_destination`.
    /// Returns the deposit ID.
    pub fn lock(
        env: Env,
        depositor: Address,
        token: String,
        amount: i128,
        eth_destination: String,
    ) -> Result<u32, Error> {
        Self::assert_initialized(&env)?;
        if is_paused(&env) {
            return Err(Error::BridgePaused);
        }
        depositor.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if token.len() == 0 {
            return Err(Error::EmptyToken);
        }
        if eth_destination.len() == 0 {
            return Err(Error::EmptyDestination);
        }

        // Daily limit check
        let new_vol = accumulate_daily_volume(&env, amount);
        if new_vol > get_daily_limit(&env) {
            return Err(Error::DailyLimitExceeded);
        }

        let fee_bps = get_fee_bps(&env);
        let fee = (amount * fee_bps as i128) / 10_000;
        let net_amount = amount - fee;

        let now = env.ledger().timestamp();
        let expiry = now + get_expiry_seconds(&env);

        let id = get_deposit_count(&env) + 1;
        let deposit = Deposit {
            depositor: depositor.clone(),
            token: token.clone(),
            amount: net_amount,
            fee,
            eth_destination: eth_destination.clone(),
            created_at: now,
            expires_at: expiry,
            status: DepositStatus::Pending,
            eth_tx_hash: None,
        };

        set_deposit(&env, id, &deposit);
        set_deposit_count(&env, id);

        let mut stats = get_stats(&env);
        stats.total_locked += net_amount;
        stats.deposit_count += 1;
        stats.active_deposits += 1;
        set_stats(&env, &stats);

        env.events().publish(
            (symbol_short!("locked"), id),
            (depositor, token, net_amount, eth_destination),
        );

        Ok(id)
    }

    // ── Relayer actions ───────────────────────────────────────────────────────

    /// Confirm that the ETH mint succeeded. Called by a trusted relayer.
    pub fn confirm_mint(
        env: Env,
        relayer: Address,
        deposit_id: u32,
        eth_tx_hash: Bytes,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        relayer.require_auth();

        if !is_relayer(&env, &relayer) {
            return Err(Error::UnknownRelayer);
        }
        if eth_tx_hash.len() == 0 {
            return Err(Error::EmptyTxHash);
        }

        let mut deposit = get_deposit(&env, deposit_id)?;
        if deposit.status != DepositStatus::Pending {
            return Err(Error::AlreadyProcessed);
        }
        if env.ledger().timestamp() > deposit.expires_at {
            return Err(Error::DepositExpired);
        }

        deposit.status = DepositStatus::Minted;
        deposit.eth_tx_hash = Some(eth_tx_hash.clone());
        set_deposit(&env, deposit_id, &deposit);

        let mut stats = get_stats(&env);
        stats.total_minted += deposit.amount;
        stats.active_deposits = stats.active_deposits.saturating_sub(1);
        set_stats(&env, &stats);

        env.events().publish(
            (symbol_short!("minted"), deposit_id),
            (relayer, eth_tx_hash),
        );

        Ok(())
    }

    // ── Depositor refund ──────────────────────────────────────────────────────

    /// Reclaim a deposit after it has expired without a mint confirmation.
    pub fn refund(env: Env, depositor: Address, deposit_id: u32) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        depositor.require_auth();

        let mut deposit = get_deposit(&env, deposit_id)?;

        if deposit.depositor != depositor {
            return Err(Error::Unauthorized);
        }
        if deposit.status != DepositStatus::Pending {
            return Err(Error::AlreadyProcessed);
        }
        if env.ledger().timestamp() <= deposit.expires_at {
            return Err(Error::NotExpired);
        }

        deposit.status = DepositStatus::Refunded;
        set_deposit(&env, deposit_id, &deposit);

        let refund_amount = deposit.amount; // fee is not refunded

        let mut stats = get_stats(&env);
        stats.total_refunded += refund_amount;
        stats.active_deposits = stats.active_deposits.saturating_sub(1);
        set_stats(&env, &stats);

        env.events().publish(
            (symbol_short!("refunded"), deposit_id),
            (depositor, refund_amount),
        );

        Ok(refund_amount)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_deposit(env: Env, deposit_id: u32) -> Result<Deposit, Error> {
        get_deposit(&env, deposit_id)
    }

    pub fn deposit_count(env: Env) -> u32 {
        get_deposit_count(&env)
    }

    pub fn get_stats(env: Env) -> BridgeStats {
        get_stats(&env)
    }

    pub fn get_fee_bps(env: Env) -> u32 {
        get_fee_bps(&env)
    }

    pub fn get_expiry_seconds(env: Env) -> u64 {
        get_expiry_seconds(&env)
    }

    pub fn get_daily_limit(env: Env) -> i128 {
        get_daily_limit(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn is_relayer(env: Env, relayer: Address) -> bool {
        is_relayer(&env, &relayer)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
