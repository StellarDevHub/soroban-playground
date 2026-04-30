// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Automated Market Maker (AMM) — Constant Product Pool
//!
//! Implements x * y = k with:
//! - LP token minting/burning
//! - 0.30% swap fee (configurable)
//! - Slippage protection via `min_out`
//! - TWAP price accumulator updated on every swap
//! - Minimum liquidity (1000 units) locked permanently

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    get_fee_bps, get_last_ts, get_lp, get_price_a_cum, get_price_b_cum, get_reserve_a,
    get_reserve_b, get_token_a, get_token_b, get_total_lp, is_initialized, set_admin,
    set_fee_bps, set_last_ts, set_lp, set_price_a_cum, set_price_b_cum, set_reserve_a,
    set_reserve_b, set_token_a, set_token_b, set_total_lp, set_nft_collection,
    get_total_volume, set_total_volume, get_total_fees, set_total_fees, get_collection_stats,
    set_collection_stats, get_floor_price, set_floor_price,
};
use crate::types::Error;

/// Minimum liquidity permanently locked on first deposit.
const MIN_LIQUIDITY: i128 = 1_000;
/// Precision multiplier for TWAP accumulators.
const TWAP_PRECISION: i128 = 1_000_000;

#[contract]
pub struct AmmPool;

#[contractimpl]
impl AmmPool {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Create the pool for `token_a` / `token_b` with an optional custom fee.
    pub fn initialize(
        env: Env,
        admin: Address,
        token_a: Address,
        token_b: Address,
        fee_bps: Option<i128>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_token_a(&env, &token_a);
        set_token_b(&env, &token_b);
        set_fee_bps(&env, fee_bps.unwrap_or(30));
        set_last_ts(&env, env.ledger().timestamp());
        Ok(())
    }

    /// Initialize NFT AMM pool with collection tracking.
    pub fn initialize_nft(
        env: Env,
        admin: Address,
        token_a: Address,
        token_b: Address,
        nft_collection: Address,
        fee_bps: Option<i128>,
    ) -> Result<(), Error> {
        if !is_initialized(&env) {
            Self::initialize(env.clone(), admin, token_a, token_b, fee_bps)?;
        }
        set_nft_collection(&env, nft_collection.clone());
        
        // Initialize collection stats
        let stats = types::CollectionStats {
            floor_price: 0,
            ceiling_price: 0,
            total_volume: 0,
            trade_count: 0,
            unique_holders: 0,
            last_update: env.ledger().timestamp(),
        };
        set_collection_stats(&env, &stats);
        
        env.events().publish((symbol_short!("nft_init"),), nft_collection);
        Ok(())
    }

    // ── Liquidity management ──────────────────────────────────────────────────

    /// Deposit `amount_a` of token_a and `amount_b` of token_b.
    /// Returns LP tokens minted.
    pub fn add_liquidity(
        env: Env,
        provider: Address,
        amount_a: i128,
        amount_b: i128,
        min_lp: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        provider.require_auth();
        if amount_a <= 0 || amount_b <= 0 {
            return Err(Error::ZeroAmount);
        }

        let ra = get_reserve_a(&env);
        let rb = get_reserve_b(&env);
        let total_lp = get_total_lp(&env);

        let lp_minted = if total_lp == 0 {
            // First deposit: geometric mean minus locked minimum.
            let lp = isqrt(amount_a, amount_b)?;
            if lp <= MIN_LIQUIDITY {
                return Err(Error::InsufficientLiquidity);
            }
            // Lock MIN_LIQUIDITY permanently (assigned to zero address equivalent).
            set_total_lp(&env, MIN_LIQUIDITY);
            lp - MIN_LIQUIDITY
        } else {
            // Proportional: min(amount_a/ra, amount_b/rb) * total_lp
            let lp_a = amount_a.checked_mul(total_lp).ok_or(Error::Overflow)? / ra;
            let lp_b = amount_b.checked_mul(total_lp).ok_or(Error::Overflow)? / rb;
            lp_a.min(lp_b)
        };

        if lp_minted < min_lp {
            return Err(Error::SlippageExceeded);
        }

        set_reserve_a(&env, ra + amount_a);
        set_reserve_b(&env, rb + amount_b);
        let new_total = get_total_lp(&env) + lp_minted;
        set_total_lp(&env, new_total);
        set_lp(&env, &provider, get_lp(&env, &provider) + lp_minted);

        env.events().publish((symbol_short!("add_liq"),), lp_minted);
        Ok(lp_minted)
    }

    /// Burn `lp_amount` LP tokens and return (amount_a, amount_b).
    pub fn remove_liquidity(
        env: Env,
        provider: Address,
        lp_amount: i128,
        min_a: i128,
        min_b: i128,
    ) -> Result<(i128, i128), Error> {
        ensure_initialized(&env)?;
        provider.require_auth();
        if lp_amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let lp_bal = get_lp(&env, &provider);
        if lp_bal < lp_amount {
            return Err(Error::InsufficientLpBalance);
        }

        let total_lp = get_total_lp(&env);
        let ra = get_reserve_a(&env);
        let rb = get_reserve_b(&env);

        let out_a = lp_amount.checked_mul(ra).ok_or(Error::Overflow)? / total_lp;
        let out_b = lp_amount.checked_mul(rb).ok_or(Error::Overflow)? / total_lp;

        if out_a < min_a || out_b < min_b {
            return Err(Error::SlippageExceeded);
        }

        set_lp(&env, &provider, lp_bal - lp_amount);
        set_total_lp(&env, total_lp - lp_amount);
        set_reserve_a(&env, ra - out_a);
        set_reserve_b(&env, rb - out_b);

        env.events().publish((symbol_short!("rm_liq"),), lp_amount);
        Ok((out_a, out_b))
    }

    // ── Swap ──────────────────────────────────────────────────────────────────

    /// Swap `amount_in` of `token_in` for the other token.
    /// `min_out` enforces slippage protection.
    /// Returns the output amount.
    pub fn swap(
        env: Env,
        trader: Address,
        token_in: Address,
        amount_in: i128,
        min_out: i128,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        trader.require_auth();
        if amount_in <= 0 {
            return Err(Error::ZeroAmount);
        }

        let ta = get_token_a(&env)?;
        let tb = get_token_b(&env)?;
        let (ra, rb, a_to_b) = if token_in == ta {
            (get_reserve_a(&env), get_reserve_b(&env), true)
        } else if token_in == tb {
            (get_reserve_b(&env), get_reserve_a(&env), false)
        } else {
            return Err(Error::InvalidToken);
        };

        if ra == 0 || rb == 0 {
            return Err(Error::InsufficientLiquidity);
        }

        let amount_out = get_amount_out(amount_in, ra, rb, get_fee_bps(&env))?;
        if amount_out < min_out {
            return Err(Error::SlippageExceeded);
        }
        if amount_out == 0 {
            return Err(Error::ZeroOutput);
        }

        // Update reserves.
        let (new_ra, new_rb) = if a_to_b {
            (ra + amount_in, rb - amount_out)
        } else {
            (rb - amount_out, ra + amount_in)
        };
        set_reserve_a(&env, if a_to_b { new_ra } else { new_rb });
        set_reserve_b(&env, if a_to_b { new_rb } else { new_ra });

        // Update TWAP accumulators.
        update_twap(&env, ra, rb);

        // Track volume and fees for NFT analytics
        let fee_amount = amount_in.checked_mul(get_fee_bps(&env)).ok_or(Error::Overflow)? / 10_000;
        set_total_volume(&env, get_total_volume(&env) + amount_in);
        set_total_fees(&env, get_total_fees(&env) + fee_amount);

        env.events().publish((symbol_short!("swap"),), amount_out);
        Ok(amount_out)
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    /// Preview output for a swap without state changes.
    pub fn get_amount_out(
        env: Env,
        amount_in: i128,
        token_in: Address,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let ta = get_token_a(&env)?;
        let tb = get_token_b(&env)?;
        let (ra, rb) = if token_in == ta {
            (get_reserve_a(&env), get_reserve_b(&env))
        } else if token_in == tb {
            (get_reserve_b(&env), get_reserve_a(&env))
        } else {
            return Err(Error::InvalidToken);
        };
        get_amount_out(amount_in, ra, rb, get_fee_bps(&env))
    }

    pub fn get_reserves(env: Env) -> Result<(i128, i128), Error> {
        ensure_initialized(&env)?;
        Ok((get_reserve_a(&env), get_reserve_b(&env)))
    }

    pub fn get_lp_balance(env: Env, addr: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_lp(&env, &addr))
    }

    pub fn get_total_lp(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_total_lp(&env))
    }

    /// Returns (price_a_cumulative, price_b_cumulative, last_timestamp).
    pub fn get_twap(env: Env) -> Result<(i128, i128, u64), Error> {
        ensure_initialized(&env)?;
        Ok((get_price_a_cum(&env), get_price_b_cum(&env), get_last_ts(&env)))
    }

    pub fn get_fee_bps(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_fee_bps(&env))
    }

    // ── NFT Collection Analytics ──────────────────────────────────────────────

    /// Get current collection statistics.
    pub fn get_collection_stats(env: Env) -> Result<types::CollectionStats, Error> {
        ensure_initialized(&env)?;
        get_collection_stats(&env).ok_or(Error::NotInitialized)
    }

    /// Update floor price based on swap activity.
    pub fn update_floor_price(
        env: Env,
        admin: Address,
        new_floor: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        
        if new_floor < 0 {
            return Err(Error::ZeroAmount);
        }
        
        set_floor_price(&env, new_floor);
        
        // Update collection stats
        if let Some(mut stats) = get_collection_stats(&env) {
            stats.floor_price = new_floor;
            stats.last_update = env.ledger().timestamp();
            set_collection_stats(&env, &stats);
        }
        
        env.events().publish((symbol_short!("floor_upd"),), new_floor);
        Ok(())
    }

    /// Get total trading volume and fees.
    pub fn get_pool_metrics(env: Env) -> Result<(i128, i128), Error> {
        ensure_initialized(&env)?;
        Ok((get_total_volume(&env), get_total_fees(&env)))
    }

    /// Get floor price for NFT collection.
    pub fn get_floor_price(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_floor_price(&env))
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

/// Constant-product output: amount_out = (amount_in * (10000 - fee_bps) * rb)
///                                       / (ra * 10000 + amount_in * (10000 - fee_bps))
fn get_amount_out(amount_in: i128, ra: i128, rb: i128, fee_bps: i128) -> Result<i128, Error> {
    if ra == 0 || rb == 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let fee_factor = 10_000 - fee_bps;
    let numerator = amount_in.checked_mul(fee_factor).ok_or(Error::Overflow)?
        .checked_mul(rb).ok_or(Error::Overflow)?;
    let denominator = ra.checked_mul(10_000).ok_or(Error::Overflow)?
        .checked_add(amount_in.checked_mul(fee_factor).ok_or(Error::Overflow)?)
        .ok_or(Error::Overflow)?;
    Ok(numerator / denominator)
}

/// Integer square root of a * b (Babylonian method).
fn isqrt(a: i128, b: i128) -> Result<i128, Error> {
    let product = a.checked_mul(b).ok_or(Error::Overflow)?;
    if product == 0 {
        return Ok(0);
    }
    let mut x = product;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + product / x) / 2;
    }
    Ok(x)
}

/// Update TWAP price accumulators using time elapsed since last swap.
fn update_twap(env: &Env, ra: i128, rb: i128) {
    let now = env.ledger().timestamp();
    let last = get_last_ts(env);
    if now <= last || ra == 0 || rb == 0 {
        set_last_ts(env, now);
        return;
    }
    let elapsed = (now - last) as i128;
    // price_a = rb / ra  (scaled by TWAP_PRECISION)
    let price_a = rb.saturating_mul(TWAP_PRECISION) / ra;
    let price_b = ra.saturating_mul(TWAP_PRECISION) / rb;
    set_price_a_cum(env, get_price_a_cum(env).saturating_add(price_a.saturating_mul(elapsed)));
    set_price_b_cum(env, get_price_b_cum(env).saturating_add(price_b.saturating_mul(elapsed)));
    set_last_ts(env, now);
}
