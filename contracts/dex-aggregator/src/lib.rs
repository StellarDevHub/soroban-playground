// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # DEX Aggregator
//!
//! Aggregates multiple on-chain liquidity pools and finds the optimal swap route:
//! - Register AMM-style pools with configurable fees and reserves.
//! - Quote prices across all pools for a token pair.
//! - Find the best single-pool or multi-hop route (up to `max_hops`).
//! - Execute swaps with slippage protection.
//! - Track per-user volume and protocol fee accrual.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

use crate::storage::{
    add_protocol_fee, add_user_volume, get_admin, get_max_hops, get_pool, get_pool_count,
    get_protocol_fee_accrued, get_protocol_fee_bps, get_user_volume, has_pool, is_initialized,
    set_admin, set_max_hops, set_pool, set_pool_count, set_protocol_fee_bps,
};
use crate::types::{Error, Pool, PriceQuote, Route, RouteHop, SwapResult};

const MAX_FEE_BPS: u32 = 1_000;
const MAX_PRICE_IMPACT_BPS: u32 = 5_000; // 50%

#[contract]
pub struct DexAggregatorContract;

#[contractimpl]
impl DexAggregatorContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        max_hops: u32,
        protocol_fee_bps: u32,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if protocol_fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_pool_count(&env, 0);
        set_max_hops(&env, max_hops.max(1).min(5));
        set_protocol_fee_bps(&env, protocol_fee_bps);
        Ok(())
    }

    // ── Admin: pool management ────────────────────────────────────────────────

    /// Register a new liquidity pool. Returns the pool ID.
    pub fn add_pool(
        env: Env,
        admin: Address,
        name: String,
        token_a: String,
        token_b: String,
        reserve_a: i128,
        reserve_b: i128,
        fee_bps: u32,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if token_a.len() == 0 || token_b.len() == 0 {
            return Err(Error::EmptyToken);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        if reserve_a <= 0 || reserve_b <= 0 {
            return Err(Error::ZeroLiquidity);
        }

        let id = get_pool_count(&env) + 1;
        let pool = Pool {
            name,
            token_a,
            token_b,
            reserve_a,
            reserve_b,
            fee_bps,
            is_active: true,
            total_volume: 0,
            swap_count: 0,
        };
        set_pool(&env, id, &pool);
        set_pool_count(&env, id);

        env.events()
            .publish((symbol_short!("pool_add"), id), fee_bps);

        Ok(id)
    }

    /// Update reserves for a pool (e.g. after external liquidity provision).
    pub fn update_reserves(
        env: Env,
        admin: Address,
        pool_id: u32,
        reserve_a: i128,
        reserve_b: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if reserve_a <= 0 || reserve_b <= 0 {
            return Err(Error::ZeroLiquidity);
        }
        let mut pool = get_pool(&env, pool_id)?;
        pool.reserve_a = reserve_a;
        pool.reserve_b = reserve_b;
        set_pool(&env, pool_id, &pool);
        Ok(())
    }

    /// Activate or deactivate a pool.
    pub fn set_pool_active(
        env: Env,
        admin: Address,
        pool_id: u32,
        active: bool,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut pool = get_pool(&env, pool_id)?;
        pool.is_active = active;
        set_pool(&env, pool_id, &pool);
        Ok(())
    }

    /// Update the protocol fee.
    pub fn set_protocol_fee(env: Env, admin: Address, fee_bps: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::InvalidFee);
        }
        set_protocol_fee_bps(&env, fee_bps);
        Ok(())
    }

    // ── Price quotes ──────────────────────────────────────────────────────────

    /// Return price quotes from every active pool that directly supports the pair.
    pub fn get_quotes(
        env: Env,
        token_in: String,
        token_out: String,
        amount_in: i128,
    ) -> Result<Vec<PriceQuote>, Error> {
        Self::assert_initialized(&env)?;
        if amount_in <= 0 {
            return Err(Error::ZeroAmount);
        }

        let count = get_pool_count(&env);
        let mut quotes = Vec::new(&env);

        for id in 1..=count {
            if !has_pool(&env, id) {
                continue;
            }
            let pool = get_pool(&env, id)?;
            if !pool.is_active {
                continue;
            }

            let (r_in, r_out) = if pool.token_a == token_in && pool.token_b == token_out {
                (pool.reserve_a, pool.reserve_b)
            } else if pool.token_b == token_in && pool.token_a == token_out {
                (pool.reserve_b, pool.reserve_a)
            } else {
                continue;
            };

            let (out, impact_bps) = Self::amm_out(amount_in, r_in, r_out, pool.fee_bps);
            quotes.push_back(PriceQuote {
                pool_id: id,
                token_in: token_in.clone(),
                token_out: token_out.clone(),
                amount_in,
                amount_out: out,
                fee_bps: pool.fee_bps,
                price_impact_bps: impact_bps,
            });
        }

        Ok(quotes)
    }

    /// Find the best direct route (highest output) for a token pair.
    pub fn find_best_route(
        env: Env,
        token_in: String,
        token_out: String,
        amount_in: i128,
    ) -> Result<Route, Error> {
        Self::assert_initialized(&env)?;
        if amount_in <= 0 {
            return Err(Error::ZeroAmount);
        }

        let count = get_pool_count(&env);
        let max_hops = get_max_hops(&env);

        // Try direct routes first
        let mut best_out: i128 = -1;
        let mut best_route: Option<Route> = None;

        for id in 1..=count {
            if !has_pool(&env, id) {
                continue;
            }
            let pool = get_pool(&env, id)?;
            if !pool.is_active {
                continue;
            }

            let (r_in, r_out) = if pool.token_a == token_in && pool.token_b == token_out {
                (pool.reserve_a, pool.reserve_b)
            } else if pool.token_b == token_in && pool.token_a == token_out {
                (pool.reserve_b, pool.reserve_a)
            } else {
                continue;
            };

            let (out, impact_bps) = Self::amm_out(amount_in, r_in, r_out, pool.fee_bps);
            if out > best_out {
                best_out = out;
                let mut hops = Vec::new(&env);
                hops.push_back(RouteHop {
                    pool_id: id,
                    token_in: token_in.clone(),
                    token_out: token_out.clone(),
                });
                best_route = Some(Route {
                    hops,
                    estimated_out: out,
                    total_fee_bps: pool.fee_bps,
                    price_impact_bps: impact_bps,
                });
            }
        }

        // Try 2-hop routes if max_hops >= 2 and no direct route found or to improve
        if max_hops >= 2 {
            for mid_id in 1..=count {
                if !has_pool(&env, mid_id) {
                    continue;
                }
                let pool_mid = get_pool(&env, mid_id)?;
                if !pool_mid.is_active {
                    continue;
                }

                // Determine intermediate token
                let (mid_token, r_in1, r_out1) =
                    if pool_mid.token_a == token_in {
                        (pool_mid.token_b.clone(), pool_mid.reserve_a, pool_mid.reserve_b)
                    } else if pool_mid.token_b == token_in {
                        (pool_mid.token_a.clone(), pool_mid.reserve_b, pool_mid.reserve_a)
                    } else {
                        continue;
                    };

                if mid_token == token_out {
                    continue; // that's a direct route, already handled
                }

                let (out1, impact1) = Self::amm_out(amount_in, r_in1, r_out1, pool_mid.fee_bps);
                if out1 <= 0 {
                    continue;
                }

                // Find best second hop: mid_token → token_out
                for id2 in 1..=count {
                    if id2 == mid_id || !has_pool(&env, id2) {
                        continue;
                    }
                    let pool2 = get_pool(&env, id2)?;
                    if !pool2.is_active {
                        continue;
                    }

                    let (r_in2, r_out2) =
                        if pool2.token_a == mid_token && pool2.token_b == token_out {
                            (pool2.reserve_a, pool2.reserve_b)
                        } else if pool2.token_b == mid_token && pool2.token_a == token_out {
                            (pool2.reserve_b, pool2.reserve_a)
                        } else {
                            continue;
                        };

                    let (out2, impact2) = Self::amm_out(out1, r_in2, r_out2, pool2.fee_bps);
                    if out2 > best_out {
                        best_out = out2;
                        let combined_fee = pool_mid.fee_bps.saturating_add(pool2.fee_bps);
                        let combined_impact = impact1.saturating_add(impact2);
                        let mut hops = Vec::new(&env);
                        hops.push_back(RouteHop {
                            pool_id: mid_id,
                            token_in: token_in.clone(),
                            token_out: mid_token.clone(),
                        });
                        hops.push_back(RouteHop {
                            pool_id: id2,
                            token_in: mid_token.clone(),
                            token_out: token_out.clone(),
                        });
                        best_route = Some(Route {
                            hops,
                            estimated_out: out2,
                            total_fee_bps: combined_fee,
                            price_impact_bps: combined_impact,
                        });
                    }
                }
            }
        }

        best_route.ok_or(Error::NoRouteFound)
    }

    // ── Swap execution ────────────────────────────────────────────────────────

    /// Execute a swap along a caller-specified route with slippage protection.
    pub fn swap(
        env: Env,
        user: Address,
        hops: Vec<RouteHop>,
        amount_in: i128,
        min_amount_out: i128,
    ) -> Result<SwapResult, Error> {
        Self::assert_initialized(&env)?;
        user.require_auth();

        if amount_in <= 0 {
            return Err(Error::ZeroAmount);
        }
        if hops.is_empty() {
            return Err(Error::EmptyRoute);
        }
        let max_hops = get_max_hops(&env);
        if hops.len() > max_hops {
            return Err(Error::RouteTooLong);
        }

        let mut current_amount = amount_in;
        let mut total_fee_bps: u32 = 0;
        let mut total_impact_bps: u32 = 0;

        // Validate all hops before mutating state
        for i in 0..hops.len() {
            let hop = hops.get(i).unwrap();
            let pool = get_pool(&env, hop.pool_id).map_err(|_| Error::InvalidHop)?;
            if !pool.is_active {
                return Err(Error::PoolInactive);
            }
            let valid = (pool.token_a == hop.token_in && pool.token_b == hop.token_out)
                || (pool.token_b == hop.token_in && pool.token_a == hop.token_out);
            if !valid {
                return Err(Error::InvalidHop);
            }
        }

        // Execute hops
        let mut updated_hops = Vec::new(&env);
        for i in 0..hops.len() {
            let hop = hops.get(i).unwrap();
            let mut pool = get_pool(&env, hop.pool_id)?;

            let (r_in, r_out, a_to_b) =
                if pool.token_a == hop.token_in && pool.token_b == hop.token_out {
                    (pool.reserve_a, pool.reserve_b, true)
                } else {
                    (pool.reserve_b, pool.reserve_a, false)
                };

            let (out, impact_bps) = Self::amm_out(current_amount, r_in, r_out, pool.fee_bps);
            if impact_bps > MAX_PRICE_IMPACT_BPS {
                return Err(Error::PriceImpactTooHigh);
            }

            // Update reserves
            if a_to_b {
                pool.reserve_a = pool.reserve_a.saturating_add(current_amount);
                pool.reserve_b = pool.reserve_b.saturating_sub(out);
            } else {
                pool.reserve_b = pool.reserve_b.saturating_add(current_amount);
                pool.reserve_a = pool.reserve_a.saturating_sub(out);
            }
            pool.total_volume = pool.total_volume.saturating_add(current_amount);
            pool.swap_count += 1;
            set_pool(&env, hop.pool_id, &pool);

            total_fee_bps = total_fee_bps.saturating_add(pool.fee_bps);
            total_impact_bps = total_impact_bps.saturating_add(impact_bps);
            current_amount = out;

            updated_hops.push_back(hop);
        }

        // Protocol fee on final output
        let proto_fee_bps = get_protocol_fee_bps(&env);
        let proto_fee = (current_amount * proto_fee_bps as i128) / 10_000;
        let final_out = current_amount - proto_fee;
        if proto_fee > 0 {
            add_protocol_fee(&env, proto_fee);
        }

        if final_out < min_amount_out {
            return Err(Error::SlippageExceeded);
        }

        add_user_volume(&env, &user, amount_in);

        let route = Route {
            hops: updated_hops,
            estimated_out: final_out,
            total_fee_bps,
            price_impact_bps: total_impact_bps,
        };

        let result = SwapResult {
            amount_in,
            amount_out: final_out,
            route,
            executed_at: env.ledger().timestamp(),
        };

        env.events().publish(
            (symbol_short!("swap"),),
            (user, amount_in, final_out),
        );

        Ok(result)
    }

    /// Convenience: find best route then execute it.
    pub fn swap_best_route(
        env: Env,
        user: Address,
        token_in: String,
        token_out: String,
        amount_in: i128,
        min_amount_out: i128,
    ) -> Result<SwapResult, Error> {
        let route = Self::find_best_route(
            env.clone(),
            token_in,
            token_out,
            amount_in,
        )?;
        Self::swap(env, user, route.hops, amount_in, min_amount_out)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_pool(env: Env, pool_id: u32) -> Result<Pool, Error> {
        get_pool(&env, pool_id)
    }

    pub fn pool_count(env: Env) -> u32 {
        get_pool_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    pub fn get_max_hops(env: Env) -> u32 {
        get_max_hops(&env)
    }

    pub fn get_protocol_fee_bps(env: Env) -> u32 {
        get_protocol_fee_bps(&env)
    }

    pub fn get_protocol_fee_accrued(env: Env) -> i128 {
        get_protocol_fee_accrued(&env)
    }

    pub fn get_user_volume(env: Env, user: Address) -> i128 {
        get_user_volume(&env, &user)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Constant-product AMM output: dy = (dx * (10000 - fee) * y) / (x * 10000 + dx * (10000 - fee))
    /// Returns (amount_out, price_impact_bps).
    fn amm_out(amount_in: i128, reserve_in: i128, reserve_out: i128, fee_bps: u32) -> (i128, u32) {
        if reserve_in <= 0 || reserve_out <= 0 || amount_in <= 0 {
            return (0, 0);
        }
        let fee_factor = (10_000 - fee_bps as i128).max(0);
        let dx_with_fee = amount_in.saturating_mul(fee_factor);
        let numerator = dx_with_fee.saturating_mul(reserve_out);
        let denominator = reserve_in
            .saturating_mul(10_000)
            .saturating_add(dx_with_fee);
        if denominator == 0 {
            return (0, 0);
        }
        let out = numerator / denominator;

        // Price impact = (ideal_out - actual_out) / ideal_out * 10000
        // ideal_out = amount_in * reserve_out / reserve_in (no fee, no slippage)
        let ideal = amount_in.saturating_mul(reserve_out) / reserve_in;
        let impact_bps = if ideal > 0 && out < ideal {
            ((ideal - out).saturating_mul(10_000) / ideal) as u32
        } else {
            0
        };

        (out, impact_bps)
    }

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
