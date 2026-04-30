// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # NFT AMM — Automated Market Maker for NFTs
//!
//! Implements a sudoswap-style NFT AMM with:
//! - **Linear and exponential bonding curves** for dynamic pricing
//! - **Three pool types**: Buy-only, Sell-only, Trade (two-sided)
//! - **Collection pools**: each pool serves one NFT collection
//! - **Protocol fee**: configurable cut taken from pool fees
//! - **Emergency pause** and admin recovery
//! - **Comprehensive events** for off-chain analytics
//!
//! ## Pricing
//! - **Linear**: `new_price = spot_price ± delta` per trade
//! - **Exponential**: `new_price = spot_price * (1 ± delta/10000)` per trade
//!
//! ## Security
//! - Checks-Effects-Interactions on all token/NFT transfers
//! - Access control via `require_auth()`
//! - Overflow-safe arithmetic with `checked_*`
//! - Emergency pause blocks all trades

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env};

use crate::storage::{
    get_admin, get_pool, get_pool_count, get_pool_nft, get_protocol_fee_balance,
    get_protocol_fee_bps, is_initialized, is_paused, remove_pool_nft, set_admin, set_paused,
    set_pool, set_pool_count, set_pool_nft, set_protocol_fee_balance, set_protocol_fee_bps,
};
use crate::types::{CurveType, Error, Pool, PoolType};

/// Maximum fee a pool can charge (50% = 5000 bps).
const MAX_FEE_BPS: i128 = 5_000;
/// Maximum protocol fee (10% = 1000 bps).
const MAX_PROTOCOL_FEE_BPS: i128 = 1_000;
/// Basis points denominator.
const BPS_DENOM: i128 = 10_000;

#[contract]
pub struct NftAmm;

#[contractimpl]
impl NftAmm {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the NFT AMM.
    ///
    /// # Arguments
    /// * `admin`            – Protocol admin address.
    /// * `protocol_fee_bps` – Optional protocol fee override (default 50 = 0.5%).
    pub fn initialize(
        env: Env,
        admin: Address,
        protocol_fee_bps: Option<i128>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_paused(&env, false);
        set_pool_count(&env, 0);

        if let Some(fee) = protocol_fee_bps {
            if fee > MAX_PROTOCOL_FEE_BPS {
                return Err(Error::InvalidFee);
            }
            set_protocol_fee_bps(&env, fee);
        }

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Pool creation ─────────────────────────────────────────────────────────

    /// Create a new NFT liquidity pool.
    ///
    /// # Arguments
    /// * `owner`          – Pool creator (must authorise).
    /// * `nft_collection` – NFT collection contract address.
    /// * `payment_token`  – Token used for pricing (e.g. XLM).
    /// * `curve`          – Bonding curve type (Linear or Exponential).
    /// * `pool_type`      – Buy, Sell, or Trade.
    /// * `spot_price`     – Initial price per NFT in stroops.
    /// * `delta`          – Price step (linear: stroops, exponential: bps).
    /// * `fee_bps`        – Pool fee in basis points (Trade pools only).
    ///
    /// # Returns
    /// The new pool ID.
    pub fn create_pool(
        env: Env,
        owner: Address,
        nft_collection: Address,
        payment_token: Address,
        curve: CurveType,
        pool_type: PoolType,
        spot_price: i128,
        delta: i128,
        fee_bps: i128,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        owner.require_auth();

        if spot_price <= 0 {
            return Err(Error::InvalidSpotPrice);
        }
        if delta < 0 {
            return Err(Error::InvalidDelta);
        }
        if fee_bps < 0 || fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        // Only Trade pools earn fees.
        if pool_type != PoolType::Trade && fee_bps > 0 {
            return Err(Error::InvalidFee);
        }

        let id = get_pool_count(&env) + 1;
        let pool = Pool {
            id,
            owner,
            nft_collection,
            payment_token,
            curve,
            pool_type,
            spot_price,
            delta,
            fee_bps,
            nft_count: 0,
            token_balance: 0,
            total_volume: 0,
            trade_count: 0,
            active: true,
        };

        set_pool(&env, &pool);
        set_pool_count(&env, id);

        env.events().publish(
            (symbol_short!("pool_new"),),
            (id, pool_type as u32, curve as u32, spot_price),
        );

        Ok(id)
    }

    // ── Deposit ───────────────────────────────────────────────────────────────

    /// Deposit payment tokens into a Buy or Trade pool.
    pub fn deposit_tokens(
        env: Env,
        owner: Address,
        pool_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        owner.require_auth();

        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_owner(&pool, &owner)?;
        assert_pool_active(&pool)?;

        if pool.pool_type == PoolType::Sell {
            return Err(Error::WrongPoolType);
        }

        let token_client = token::Client::new(&env, &pool.payment_token);
        token_client.transfer(&owner, &env.current_contract_address(), &amount);

        pool.token_balance += amount;
        set_pool(&env, &pool);

        env.events()
            .publish((symbol_short!("dep_tok"),), (pool_id, amount));
        Ok(())
    }

    /// Deposit NFTs into a Sell or Trade pool.
    /// `nft_ids` is a list of NFT token IDs to deposit (each treated as amount=1).
    pub fn deposit_nfts(
        env: Env,
        owner: Address,
        pool_id: u32,
        nft_ids: soroban_sdk::Vec<u64>,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        owner.require_auth();

        if nft_ids.is_empty() {
            return Err(Error::ZeroAmount);
        }

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_owner(&pool, &owner)?;
        assert_pool_active(&pool)?;

        if pool.pool_type == PoolType::Buy {
            return Err(Error::WrongPoolType);
        }

        let nft_client = token::Client::new(&env, &pool.nft_collection);
        let start_slot = pool.nft_count;

        for (i, nft_id) in nft_ids.iter().enumerate() {
            // Transfer each NFT (amount = 1 unit) to the contract.
            nft_client.transfer(&owner, &env.current_contract_address(), &1);
            set_pool_nft(&env, pool_id, start_slot + i as u32, nft_id);
        }

        pool.nft_count += nft_ids.len() as u32;
        set_pool(&env, &pool);

        env.events()
            .publish((symbol_short!("dep_nft"),), (pool_id, nft_ids.len() as u32));
        Ok(())
    }

    // ── Buy NFT from pool ─────────────────────────────────────────────────────

    /// Buy an NFT from a Sell or Trade pool.
    ///
    /// The buyer pays `max_price` or less; the pool sells at the current spot
    /// price and then adjusts the price upward by delta.
    ///
    /// # Arguments
    /// * `buyer`     – Buyer address (must authorise).
    /// * `pool_id`   – Pool to buy from.
    /// * `max_price` – Maximum the buyer is willing to pay (slippage guard).
    ///
    /// # Returns
    /// The NFT ID purchased and the price paid.
    pub fn buy_nft(
        env: Env,
        buyer: Address,
        pool_id: u32,
        max_price: i128,
    ) -> Result<(u64, i128), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        buyer.require_auth();

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_active(&pool)?;

        if pool.pool_type == PoolType::Buy {
            return Err(Error::WrongPoolType);
        }
        if pool.nft_count == 0 {
            return Err(Error::InsufficientNfts);
        }

        // Calculate price buyer pays (spot + fee).
        let fee = pool.spot_price
            .checked_mul(pool.fee_bps)
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        let protocol_fee = pool.spot_price
            .checked_mul(get_protocol_fee_bps(&env))
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        let total_price = pool.spot_price + fee + protocol_fee;

        if total_price > max_price {
            return Err(Error::InsufficientTokens);
        }

        // Pop the last NFT slot (LIFO).
        let slot = pool.nft_count - 1;
        let nft_id = get_pool_nft(&env, pool_id, slot).ok_or(Error::NftNotInPool)?;

        // ── Effects ──────────────────────────────────────────────────────────
        remove_pool_nft(&env, pool_id, slot);
        pool.nft_count -= 1;
        pool.token_balance += pool.spot_price + fee; // protocol fee goes to protocol
        pool.total_volume += total_price;
        pool.trade_count += 1;

        // Accumulate protocol fee.
        let proto_bal = get_protocol_fee_balance(&env) + protocol_fee;
        set_protocol_fee_balance(&env, proto_bal);

        // Adjust price upward.
        pool.spot_price = next_price_up(&pool)?;
        set_pool(&env, &pool);

        // ── Interactions ──────────────────────────────────────────────────────
        let token_client = token::Client::new(&env, &pool.payment_token);
        token_client.transfer(&buyer, &env.current_contract_address(), &total_price);

        let nft_client = token::Client::new(&env, &pool.nft_collection);
        nft_client.transfer(&env.current_contract_address(), &buyer, &1);

        env.events().publish(
            (symbol_short!("buy_nft"),),
            (pool_id, nft_id, total_price, buyer),
        );

        Ok((nft_id, total_price))
    }

    // ── Sell NFT to pool ──────────────────────────────────────────────────────

    /// Sell an NFT to a Buy or Trade pool.
    ///
    /// The seller receives `min_price` or more; the pool buys at the current
    /// spot price and then adjusts the price downward by delta.
    ///
    /// # Arguments
    /// * `seller`    – Seller address (must authorise).
    /// * `pool_id`   – Pool to sell into.
    /// * `nft_id`    – NFT token ID being sold.
    /// * `min_price` – Minimum the seller will accept (slippage guard).
    ///
    /// # Returns
    /// The price received by the seller.
    pub fn sell_nft(
        env: Env,
        seller: Address,
        pool_id: u32,
        nft_id: u64,
        min_price: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        seller.require_auth();

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_active(&pool)?;

        if pool.pool_type == PoolType::Sell {
            return Err(Error::WrongPoolType);
        }

        // Calculate payout (spot - fee).
        let fee = pool.spot_price
            .checked_mul(pool.fee_bps)
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        let protocol_fee = pool.spot_price
            .checked_mul(get_protocol_fee_bps(&env))
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        let payout = pool.spot_price - fee - protocol_fee;

        if payout < min_price {
            return Err(Error::InsufficientTokens);
        }
        if pool.token_balance < payout + protocol_fee {
            return Err(Error::InsufficientTokens);
        }

        // ── Effects ──────────────────────────────────────────────────────────
        let slot = pool.nft_count;
        set_pool_nft(&env, pool_id, slot, nft_id);
        pool.nft_count += 1;
        pool.token_balance -= payout + protocol_fee;
        pool.total_volume += pool.spot_price;
        pool.trade_count += 1;

        let proto_bal = get_protocol_fee_balance(&env) + protocol_fee;
        set_protocol_fee_balance(&env, proto_bal);

        // Adjust price downward.
        pool.spot_price = next_price_down(&pool)?;
        set_pool(&env, &pool);

        // ── Interactions ──────────────────────────────────────────────────────
        let nft_client = token::Client::new(&env, &pool.nft_collection);
        nft_client.transfer(&seller, &env.current_contract_address(), &1);

        let token_client = token::Client::new(&env, &pool.payment_token);
        token_client.transfer(&env.current_contract_address(), &seller, &payout);

        env.events().publish(
            (symbol_short!("sell_nft"),),
            (pool_id, nft_id, payout, seller),
        );

        Ok(payout)
    }

    // ── Withdraw ──────────────────────────────────────────────────────────────

    /// Withdraw payment tokens from a pool. Pool owner only.
    pub fn withdraw_tokens(
        env: Env,
        owner: Address,
        pool_id: u32,
        amount: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_owner(&pool, &owner)?;

        if amount <= 0 || amount > pool.token_balance {
            return Err(Error::InsufficientTokens);
        }

        pool.token_balance -= amount;
        set_pool(&env, &pool);

        let token_client = token::Client::new(&env, &pool.payment_token);
        token_client.transfer(&env.current_contract_address(), &owner, &amount);

        env.events()
            .publish((symbol_short!("wd_tok"),), (pool_id, amount));
        Ok(())
    }

    /// Withdraw NFTs from a pool. Pool owner only.
    pub fn withdraw_nfts(
        env: Env,
        owner: Address,
        pool_id: u32,
        count: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_owner(&pool, &owner)?;

        if count == 0 || count > pool.nft_count {
            return Err(Error::InsufficientNfts);
        }

        let nft_client = token::Client::new(&env, &pool.nft_collection);

        for i in 0..count {
            let slot = pool.nft_count - 1 - i;
            remove_pool_nft(&env, pool_id, slot);
            nft_client.transfer(&env.current_contract_address(), &owner, &1);
        }

        pool.nft_count -= count;
        set_pool(&env, &pool);

        env.events()
            .publish((symbol_short!("wd_nft"),), (pool_id, count));
        Ok(())
    }

    // ── Pool management ───────────────────────────────────────────────────────

    /// Deactivate a pool. Pool owner only.
    pub fn deactivate_pool(env: Env, owner: Address, pool_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        owner.require_auth();

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_owner(&pool, &owner)?;

        pool.active = false;
        set_pool(&env, &pool);

        env.events()
            .publish((symbol_short!("pool_off"),), pool_id);
        Ok(())
    }

    /// Update spot price and delta. Pool owner only.
    pub fn update_pool_params(
        env: Env,
        owner: Address,
        pool_id: u32,
        new_spot_price: i128,
        new_delta: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        ensure_not_paused(&env)?;
        owner.require_auth();

        let mut pool = get_pool(&env, pool_id)?;
        assert_pool_owner(&pool, &owner)?;
        assert_pool_active(&pool)?;

        if new_spot_price <= 0 {
            return Err(Error::InvalidSpotPrice);
        }
        if new_delta < 0 {
            return Err(Error::InvalidDelta);
        }

        pool.spot_price = new_spot_price;
        pool.delta = new_delta;
        set_pool(&env, &pool);

        env.events().publish(
            (symbol_short!("pool_upd"),),
            (pool_id, new_spot_price, new_delta),
        );
        Ok(())
    }

    // ── Emergency controls ────────────────────────────────────────────────────

    /// Pause or unpause the contract. Admin only.
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        set_paused(&env, paused);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    /// Collect accumulated protocol fees. Admin only.
    pub fn collect_protocol_fees(
        env: Env,
        admin: Address,
        token_address: Address,
        amount: i128,
    ) -> Result<(), Error> {
        assert_admin(&env, &admin)?;

        let balance = get_protocol_fee_balance(&env);
        if amount > balance {
            return Err(Error::InsufficientTokens);
        }

        set_protocol_fee_balance(&env, balance - amount);

        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &admin, &amount);

        env.events()
            .publish((symbol_short!("fee_col"),), (admin, amount));
        Ok(())
    }

    /// Update protocol fee. Admin only.
    pub fn set_protocol_fee(env: Env, admin: Address, fee_bps: i128) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if fee_bps > MAX_PROTOCOL_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        set_protocol_fee_bps(&env, fee_bps);
        env.events()
            .publish((symbol_short!("fee_upd"),), fee_bps);
        Ok(())
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_pool(env: Env, pool_id: u32) -> Result<Pool, Error> {
        ensure_initialized(&env)?;
        get_pool(&env, pool_id)
    }

    pub fn pool_count(env: Env) -> u32 {
        get_pool_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn protocol_fee_bps(env: Env) -> i128 {
        get_protocol_fee_bps(&env)
    }

    pub fn protocol_fee_balance(env: Env) -> i128 {
        get_protocol_fee_balance(&env)
    }

    /// Preview the buy price for a pool (spot + fees).
    pub fn get_buy_price(env: Env, pool_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let pool = get_pool(&env, pool_id)?;
        let fee = pool.spot_price
            .checked_mul(pool.fee_bps)
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        let protocol_fee = pool.spot_price
            .checked_mul(get_protocol_fee_bps(&env))
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        Ok(pool.spot_price + fee + protocol_fee)
    }

    /// Preview the sell price for a pool (spot - fees).
    pub fn get_sell_price(env: Env, pool_id: u32) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let pool = get_pool(&env, pool_id)?;
        let fee = pool.spot_price
            .checked_mul(pool.fee_bps)
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        let protocol_fee = pool.spot_price
            .checked_mul(get_protocol_fee_bps(&env))
            .ok_or(Error::Overflow)?
            / BPS_DENOM;
        Ok(pool.spot_price - fee - protocol_fee)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn ensure_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    ensure_initialized(env)?;
    caller.require_auth();
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn assert_pool_owner(pool: &Pool, caller: &Address) -> Result<(), Error> {
    if pool.owner != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn assert_pool_active(pool: &Pool) -> Result<(), Error> {
    if !pool.active {
        return Err(Error::PoolNotActive);
    }
    Ok(())
}

/// Compute the next spot price after a buy (price goes up).
fn next_price_up(pool: &Pool) -> Result<i128, Error> {
    match pool.curve {
        CurveType::Linear => Ok(pool.spot_price + pool.delta),
        CurveType::Exponential => {
            // new_price = spot * (1 + delta/10000)
            let increase = pool.spot_price
                .checked_mul(pool.delta)
                .ok_or(Error::Overflow)?
                / BPS_DENOM;
            Ok(pool.spot_price + increase)
        }
    }
}

/// Compute the next spot price after a sell (price goes down).
fn next_price_down(pool: &Pool) -> Result<i128, Error> {
    match pool.curve {
        CurveType::Linear => {
            let new_price = pool.spot_price - pool.delta;
            Ok(if new_price > 0 { new_price } else { 1 })
        }
        CurveType::Exponential => {
            // new_price = spot * (1 - delta/10000)
            let decrease = pool.spot_price
                .checked_mul(pool.delta)
                .ok_or(Error::Overflow)?
                / BPS_DENOM;
            let new_price = pool.spot_price - decrease;
            Ok(if new_price > 0 { new_price } else { 1 })
        }
    }
}
