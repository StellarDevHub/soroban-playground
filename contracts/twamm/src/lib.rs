// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # TWAMM – Time-Weighted Average Market Maker
//!
//! Breaks large orders into an infinite stream of infinitesimally-small
//! sub-orders executed at every ledger close, smoothing slippage and
//! eliminating MEV front-running on institutional-scale swaps.
//!
//! ## Design
//!
//! ### AMM pool
//! Constant-product invariant: `reserve_a * reserve_b = k`.
//! Spot swaps (non-TWAMM) are settled immediately using the classic formula.
//!
//! ### Piecewise-linear execution (virtual orders)
//! Active TWAMM orders are collected into two *aggregate* sell-rate
//! accumulators: `rate_a` (tokens A sold per ledger) and `rate_b` (tokens B
//! sold per ledger).  On every interaction the contract applies the
//! closed-form piecewise-linear (constant-rate) trade formula derived by
//! Paradigm (TWAMM paper, 2021):
//!
//! ```text
//! Given reserves (X, Y), sell-rates (a, b) over Δt ledgers:
//!
//!   k  = X * Y
//!   c  = sqrt(a / b)              (asymptotic exchange rate)
//!   p  = sqrt(a * b)              (geometric mean rate)
//!   e  = exp(-2 * p * Δt / sqrt(k))
//!
//!   X' = sqrt(k) * (1/c) * (X/sqrt(k) + (1-e)*(c/2 - Y/(2*sqrt(k)*c)))
//!   Y' = sqrt(k) * c   * (Y/sqrt(k)*c + (1-e)*(1/2 - X*c/(2*sqrt(k))))
//! ```
//!
//! For small Δt the exponential is approximated to avoid overflow.
//! Because Soroban lacks `f64`, all arithmetic is fixed-point (18 decimals,
//! stored as `i128`).
//!
//! ### Lazy evaluation
//! Pool state is **not** updated on every ledger.  The `last_updated_ledger`
//! field tracks when the virtual order pool was last settled.  Any call that
//! reads or mutates the pool first triggers `_apply_virtual_orders` to catch
//! up, paying only for the ledgers actually elapsed since the last touch.
//!
//! ### Order lifecycle
//! ```
//! submit_order → [ Active ] ──cancel──> [ Cancelled ]
//!                    │ (duration_ledgers pass)
//!                    └──────────────────> [ Completed ]
//! ```
//! Cancellation refunds the proportional unexecuted balance.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec};

// ─── Fixed-point helpers (18 decimal places) ────────────────────────────────

/// One unit in fixed-point representation (1.0 == SCALE).
const SCALE: i128 = 1_000_000_000_000_000_000_i128; // 1e18

/// Integer square root via Newton's method (returns floor(sqrt(n))).
fn isqrt(n: i128) -> i128 {
    if n <= 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Fixed-point multiply: (a * b) / SCALE, with saturation to avoid overflow.
fn fp_mul(a: i128, b: i128) -> i128 {
    // Use i128 with intermediate i128 arithmetic; cap at i64::MAX to be safe.
    // a and b are at most ~1e36 before divide, which fits i128 (max ~1.7e38).
    let result = a.saturating_mul(b) / SCALE;
    result
}

/// Fixed-point divide: (a * SCALE) / b.
fn fp_div(a: i128, b: i128) -> i128 {
    if b == 0 {
        return 0;
    }
    a.saturating_mul(SCALE) / b
}

/// Fixed-point sqrt: returns sqrt(a) where a is in fixed-point (18 decimals).
/// Result is also in fixed-point.
fn fp_sqrt(a: i128) -> i128 {
    if a <= 0 {
        return 0;
    }
    // sqrt(a * SCALE^0) where a is already scaled:
    // result = sqrt(a) in raw, * SCALE / sqrt(SCALE) = sqrt(a * SCALE)
    isqrt(a.saturating_mul(SCALE))
}

/// Taylor-series approximation of e^(-x) for small x (fixed-point).
/// Uses 6 terms: 1 - x + x²/2! - x³/3! + x⁴/4! - x⁵/5!
fn fp_exp_neg(x: i128) -> i128 {
    // Clamp to avoid divergence; for x >= 20 the result is ~0.
    if x >= 20 * SCALE {
        return 0;
    }
    let x2 = fp_mul(x, x);
    let x3 = fp_mul(x2, x);
    let x4 = fp_mul(x3, x);
    let x5 = fp_mul(x4, x);

    let term1 = x;
    let term2 = x2 / 2;
    let term3 = x3 / 6;
    let term4 = x4 / 24;
    let term5 = x5 / 120;

    SCALE - term1 + term2 - term3 + term4 - term5
}

// ─── Storage key types ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Pool,
    OrderSeq,
    Order(u64),
    Paused,
}

// ─── Shared types ────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum OrderStatus {
    Active,
    Completed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TwammOrder {
    /// Unique order ID.
    pub id: u64,
    /// Address that submitted the order.
    pub owner: Address,
    /// Token being sold (true = A, false = B).
    pub sell_a: bool,
    /// Total amount deposited for this order (raw i128 token units).
    pub total_amount: i128,
    /// Amount already executed (filled by virtual order settlement).
    pub executed_amount: i128,
    /// Sell rate per ledger (total_amount / duration_ledgers), fixed-point.
    pub rate_per_ledger: i128,
    /// Ledger number when the order was submitted.
    pub start_ledger: u32,
    /// Ledger number when the order expires.
    pub end_ledger: u32,
    /// Current status.
    pub status: OrderStatus,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct PoolState {
    /// Reserve of token A (raw i128, not fixed-point).
    pub reserve_a: i128,
    /// Reserve of token B (raw i128, not fixed-point).
    pub reserve_b: i128,
    /// LP fee in basis points (e.g. 30 = 0.30%).
    pub fee_bps: u32,
    /// Admin address (can adjust fees and pause).
    pub admin: Address,
    /// Ledger at which virtual orders were last settled.
    pub last_updated_ledger: u32,
    /// Aggregate sell-rate of A→B orders currently active (fixed-point / ledger).
    pub agg_rate_a: i128,
    /// Aggregate sell-rate of B→A orders currently active (fixed-point / ledger).
    pub agg_rate_b: i128,
    /// Whether the pool is paused.
    pub paused: bool,
}

// ─── Error type ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    AlreadyInitialized,
    NotInitialized,
    Unauthorized,
    InvalidAmount,
    InvalidDuration,
    OrderNotFound,
    OrderNotActive,
    InsufficientLiquidity,
    Paused,
    Overflow,
}

impl From<Error> for soroban_sdk::Error {
    fn from(e: Error) -> soroban_sdk::Error {
        soroban_sdk::Error::from_contract_error(match e {
            Error::AlreadyInitialized => 1,
            Error::NotInitialized => 2,
            Error::Unauthorized => 3,
            Error::InvalidAmount => 4,
            Error::InvalidDuration => 5,
            Error::OrderNotFound => 6,
            Error::OrderNotActive => 7,
            Error::InsufficientLiquidity => 8,
            Error::Paused => 9,
            Error::Overflow => 10,
        })
    }
}

// ─── Contract struct ─────────────────────────────────────────────────────────

#[contract]
pub struct TwammContract;

// ─── Internal helpers ────────────────────────────────────────────────────────

impl TwammContract {
    fn load_pool(env: &Env) -> Result<PoolState, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Pool)
            .ok_or(Error::NotInitialized)
    }

    fn save_pool(env: &Env, pool: &PoolState) {
        env.storage().persistent().set(&DataKey::Pool, pool);
    }

    fn next_order_id(env: &Env) -> u64 {
        let seq: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::OrderSeq)
            .unwrap_or(0u64);
        let next = seq + 1;
        env.storage().persistent().set(&DataKey::OrderSeq, &next);
        next
    }

    fn load_order(env: &Env, id: u64) -> Result<TwammOrder, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(id))
            .ok_or(Error::OrderNotFound)
    }

    fn save_order(env: &Env, order: &TwammOrder) {
        env.storage()
            .persistent()
            .set(&DataKey::Order(order.id), order);
    }

    /// Apply pending virtual orders since `pool.last_updated_ledger`.
    ///
    /// This is the core lazy-evaluation function.  It advances the AMM state
    /// by settling all aggregate TWAMM flow accumulated between
    /// `last_updated_ledger` and the current ledger.
    fn apply_virtual_orders(env: &Env, pool: &mut PoolState) {
        let current_ledger = env.ledger().sequence();
        if current_ledger <= pool.last_updated_ledger {
            return;
        }
        let delta = (current_ledger - pool.last_updated_ledger) as i128;

        // If no virtual orders are active, nothing to do except advance the clock.
        if pool.agg_rate_a == 0 && pool.agg_rate_b == 0 {
            pool.last_updated_ledger = current_ledger;
            return;
        }

        // Convert raw reserves to fixed-point for the math below.
        let x = pool.reserve_a.saturating_mul(SCALE); // A in fp
        let y = pool.reserve_b.saturating_mul(SCALE); // B in fp

        let k = fp_mul(x, y); // invariant in fp²

        // Aggregate sell rates (already fixed-point per ledger).
        let a = pool.agg_rate_a; // rate A→B
        let b = pool.agg_rate_b; // rate B→A

        let (new_x_fp, new_y_fp) = if b == 0 {
            // Only A→B orders: simple one-sided linear approximation.
            // sell_amount = a * delta (fixed-point tokens A)
            let sold = a.saturating_mul(delta);
            // dx = sold, dy = -k/x' + k/x (constant product)
            let new_x = x.saturating_add(sold);
            if new_x <= 0 {
                (x, y)
            } else {
                let new_y = fp_div(k, new_x);
                (new_x, new_y)
            }
        } else if a == 0 {
            // Only B→A orders.
            let sold = b.saturating_mul(delta);
            let new_y = y.saturating_add(sold);
            if new_y <= 0 {
                (x, y)
            } else {
                let new_x = fp_div(k, new_y);
                (new_x, new_y)
            }
        } else {
            // Both directions: piecewise-linear closed-form formula.
            // c = sqrt(a/b), p = sqrt(a*b)
            let c = fp_sqrt(fp_div(a, b));
            let p = fp_sqrt(fp_mul(a, b));

            if c == 0 || p == 0 {
                (x, y)
            } else {
                let sqrt_k = fp_sqrt(k);
                if sqrt_k == 0 {
                    (x, y)
                } else {
                    // exponent: 2 * p * Δt / sqrt(k)
                    let exp_arg =
                        fp_div(fp_mul(2 * SCALE, fp_mul(p, delta * SCALE / SCALE)), sqrt_k);
                    let e_neg = fp_exp_neg(exp_arg); // e^(-exp_arg) in fp

                    // one_minus_e = 1 - e^(-arg)
                    let one_minus_e = SCALE - e_neg;

                    // X' = sqrt(k)/c * (x/sqrt(k) + (1-e)*(c/2 - y/(2*sqrt(k)*c)))
                    let x_over_sqrtk = fp_div(x, sqrt_k);
                    let c_half = c / 2;
                    let y_part = fp_div(y, fp_mul(2 * SCALE, fp_mul(sqrt_k, c)));
                    let bracket_x = x_over_sqrtk
                        .saturating_add(fp_mul(one_minus_e, c_half.saturating_sub(y_part)));
                    let new_x = fp_mul(fp_div(sqrt_k, c), bracket_x);

                    // Y' = sqrt(k)*c * (y/(sqrt(k)*c) + (1-e)*(1/2 - x*c/(2*sqrt(k))))
                    let y_over_sqrtk_c = fp_div(y, fp_mul(sqrt_k, c));
                    let half = SCALE / 2;
                    let xc_part = fp_div(fp_mul(x, c), fp_mul(2 * SCALE, sqrt_k));
                    let bracket_y = y_over_sqrtk_c
                        .saturating_add(fp_mul(one_minus_e, half.saturating_sub(xc_part)));
                    let new_y = fp_mul(fp_mul(sqrt_k, c), bracket_y);

                    (new_x.max(SCALE), new_y.max(SCALE))
                }
            }
        };

        // Convert back from fixed-point to raw token units.
        pool.reserve_a = (new_x_fp / SCALE).max(1);
        pool.reserve_b = (new_y_fp / SCALE).max(1);
        pool.last_updated_ledger = current_ledger;
    }

    /// Recompute aggregate rates by scanning all active orders.
    /// Called after an order is submitted or cancelled to keep `agg_rate_a/b` accurate.
    fn recompute_rates(env: &Env, pool: &mut PoolState) {
        let seq: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::OrderSeq)
            .unwrap_or(0u64);
        let current = env.ledger().sequence();
        let mut ra: i128 = 0;
        let mut rb: i128 = 0;
        for i in 1..=seq {
            if let Some(order) = env
                .storage()
                .persistent()
                .get::<DataKey, TwammOrder>(&DataKey::Order(i))
            {
                if order.status == OrderStatus::Active && order.end_ledger > current {
                    if order.sell_a {
                        ra = ra.saturating_add(order.rate_per_ledger);
                    } else {
                        rb = rb.saturating_add(order.rate_per_ledger);
                    }
                }
            }
        }
        pool.agg_rate_a = ra;
        pool.agg_rate_b = rb;
    }
}

// ─── Public interface ────────────────────────────────────────────────────────

#[contractimpl]
impl TwammContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the AMM pool.
    ///
    /// * `admin`           – address that can pause/unpause and change fees.
    /// * `initial_a`       – initial liquidity for token A.
    /// * `initial_b`       – initial liquidity for token B.
    /// * `fee_bps`         – LP swap fee in basis points (max 1000 = 10%).
    pub fn initialize(
        env: Env,
        admin: Address,
        initial_a: i128,
        initial_b: i128,
        fee_bps: u32,
    ) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::Pool) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        if initial_a <= 0 || initial_b <= 0 {
            return Err(Error::InvalidAmount);
        }
        if fee_bps > 1000 {
            return Err(Error::InvalidAmount);
        }

        let pool = PoolState {
            reserve_a: initial_a,
            reserve_b: initial_b,
            fee_bps,
            admin: admin.clone(),
            last_updated_ledger: env.ledger().sequence(),
            agg_rate_a: 0,
            agg_rate_b: 0,
            paused: false,
        };
        Self::save_pool(&env, &pool);

        env.events().publish(
            (symbol_short!("init"), symbol_short!("twamm")),
            (admin, initial_a, initial_b, fee_bps),
        );
        Ok(())
    }

    // ── Instant spot swap ─────────────────────────────────────────────────────

    /// Swap `amount_in` of token A for token B (or B→A if `sell_a = false`).
    ///
    /// Applies the constant-product formula after first settling any pending
    /// virtual orders (lazy evaluation).  Fee is deducted from `amount_in`.
    pub fn swap(
        env: Env,
        caller: Address,
        sell_a: bool,
        amount_in: i128,
        min_out: i128,
    ) -> Result<i128, Error> {
        caller.require_auth();
        if amount_in <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pool = Self::load_pool(&env)?;
        if pool.paused {
            return Err(Error::Paused);
        }

        // Lazy-evaluate pending virtual orders.
        Self::apply_virtual_orders(&env, &mut pool);

        // Deduct fee.
        let fee = amount_in * pool.fee_bps as i128 / 10_000;
        let effective_in = amount_in - fee;

        let amount_out = if sell_a {
            // A→B: dy = y * dx / (x + dx)
            pool.reserve_b * effective_in / (pool.reserve_a + effective_in)
        } else {
            // B→A: dx = x * dy / (y + dy)
            pool.reserve_a * effective_in / (pool.reserve_b + effective_in)
        };

        if amount_out < min_out {
            return Err(Error::InsufficientLiquidity);
        }

        if sell_a {
            pool.reserve_a += effective_in;
            pool.reserve_b -= amount_out;
        } else {
            pool.reserve_b += effective_in;
            pool.reserve_a -= amount_out;
        }

        if pool.reserve_a <= 0 || pool.reserve_b <= 0 {
            return Err(Error::InsufficientLiquidity);
        }

        Self::save_pool(&env, &pool);
        env.events().publish(
            (symbol_short!("swap"), symbol_short!("twamm")),
            (caller, sell_a, amount_in, amount_out),
        );
        Ok(amount_out)
    }

    // ── Add / Remove liquidity ────────────────────────────────────────────────

    /// Add liquidity proportionally.  Returns the LP share minted (scaled by SCALE).
    pub fn add_liquidity(
        env: Env,
        provider: Address,
        amount_a: i128,
        amount_b: i128,
    ) -> Result<i128, Error> {
        provider.require_auth();
        if amount_a <= 0 || amount_b <= 0 {
            return Err(Error::InvalidAmount);
        }

        let mut pool = Self::load_pool(&env)?;
        if pool.paused {
            return Err(Error::Paused);
        }
        Self::apply_virtual_orders(&env, &mut pool);

        pool.reserve_a += amount_a;
        pool.reserve_b += amount_b;
        Self::save_pool(&env, &pool);

        let lp_minted = isqrt(amount_a.saturating_mul(amount_b));
        env.events().publish(
            (symbol_short!("addliq"), symbol_short!("twamm")),
            (provider, amount_a, amount_b),
        );
        Ok(lp_minted)
    }

    // ── TWAMM order submission ────────────────────────────────────────────────

    /// Submit a new TWAMM order.
    ///
    /// The caller deposits `amount` of the sell token into the contract's
    /// virtual order pool.  The order is executed linearly over
    /// `duration_ledgers` ledgers.
    ///
    /// Returns the assigned order ID.
    pub fn submit_order(
        env: Env,
        owner: Address,
        sell_a: bool,
        amount: i128,
        duration_ledgers: u32,
    ) -> Result<u64, Error> {
        owner.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if duration_ledgers == 0 {
            return Err(Error::InvalidDuration);
        }

        let mut pool = Self::load_pool(&env)?;
        if pool.paused {
            return Err(Error::Paused);
        }

        // Settle pending virtual orders before registering the new rate.
        Self::apply_virtual_orders(&env, &mut pool);

        let start_ledger = env.ledger().sequence();
        let end_ledger = start_ledger + duration_ledgers;

        // Fixed-point rate per ledger.
        let rate_per_ledger = fp_div(
            amount.saturating_mul(SCALE), // scale amount to fp
            (duration_ledgers as i128).saturating_mul(SCALE),
        );

        let id = Self::next_order_id(&env);
        let order = TwammOrder {
            id,
            owner: owner.clone(),
            sell_a,
            total_amount: amount,
            executed_amount: 0,
            rate_per_ledger,
            start_ledger,
            end_ledger,
            status: OrderStatus::Active,
        };
        Self::save_order(&env, &order);

        // Update aggregate rates incrementally.
        if sell_a {
            pool.agg_rate_a = pool.agg_rate_a.saturating_add(rate_per_ledger);
        } else {
            pool.agg_rate_b = pool.agg_rate_b.saturating_add(rate_per_ledger);
        }
        Self::save_pool(&env, &pool);

        env.events().publish(
            (symbol_short!("order"), symbol_short!("twamm")),
            (owner, id, sell_a, amount, duration_ledgers),
        );
        Ok(id)
    }

    // ── Order cancellation ────────────────────────────────────────────────────

    /// Cancel an active TWAMM order and receive a proportional refund of the
    /// unexecuted balance.
    ///
    /// The refund is computed as:
    /// ```text
    /// refund = total_amount * (end_ledger - current_ledger) / duration_ledgers
    /// ```
    ///
    /// Returns the refund amount.
    pub fn cancel_order(env: Env, caller: Address, order_id: u64) -> Result<i128, Error> {
        caller.require_auth();

        let mut order = Self::load_order(&env, order_id)?;

        if order.owner != caller {
            return Err(Error::Unauthorized);
        }
        if order.status != OrderStatus::Active {
            return Err(Error::OrderNotActive);
        }

        let mut pool = Self::load_pool(&env)?;

        // Settle pending virtual orders before cancellation.
        Self::apply_virtual_orders(&env, &mut pool);

        let current_ledger = env.ledger().sequence();
        let duration = (order.end_ledger - order.start_ledger) as i128;

        // Proportion of duration remaining (clamped to [0, 1]).
        let remaining_ledgers = if current_ledger >= order.end_ledger {
            0i128
        } else {
            (order.end_ledger - current_ledger) as i128
        };

        // Refund = total_amount * remaining_ledgers / total_duration
        let refund = if duration > 0 {
            order.total_amount * remaining_ledgers / duration
        } else {
            0
        };

        order.executed_amount = order.total_amount - refund;
        order.status = OrderStatus::Cancelled;
        Self::save_order(&env, &order);

        // Remove rate contribution and recompute aggregates.
        Self::recompute_rates(&env, &mut pool);
        Self::save_pool(&env, &pool);

        env.events().publish(
            (symbol_short!("cancel"), symbol_short!("twamm")),
            (caller, order_id, refund),
        );
        Ok(refund)
    }

    // ── Settlement of completed orders ────────────────────────────────────────

    /// Settle (mark completed) all expired orders, updating aggregate rates.
    ///
    /// Anyone can call this to clean up stale orders and reclaim gas.
    pub fn settle_expired(env: Env) -> Result<u32, Error> {
        let mut pool = Self::load_pool(&env)?;
        Self::apply_virtual_orders(&env, &mut pool);

        let current_ledger = env.ledger().sequence();
        let seq: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::OrderSeq)
            .unwrap_or(0u64);

        let mut settled: u32 = 0;
        for i in 1..=seq {
            if let Some(mut order) = env
                .storage()
                .persistent()
                .get::<DataKey, TwammOrder>(&DataKey::Order(i))
            {
                if order.status == OrderStatus::Active && current_ledger >= order.end_ledger {
                    order.executed_amount = order.total_amount;
                    order.status = OrderStatus::Completed;
                    Self::save_order(&env, &order);
                    settled += 1;
                }
            }
        }

        if settled > 0 {
            Self::recompute_rates(&env, &mut pool);
            Self::save_pool(&env, &pool);
        }

        Ok(settled)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    /// Return current pool state (reserves, fee, rates).
    pub fn get_pool(env: Env) -> Result<PoolState, Error> {
        Self::load_pool(&env)
    }

    /// Return a specific order by ID.
    pub fn get_order(env: Env, order_id: u64) -> Result<TwammOrder, Error> {
        Self::load_order(&env, order_id)
    }

    /// Return the total number of orders ever created.
    pub fn order_count(env: Env) -> u64 {
        env.storage()
            .persistent()
            .get(&DataKey::OrderSeq)
            .unwrap_or(0u64)
    }

    /// Return the current spot price of A in terms of B (fixed-point).
    pub fn spot_price(env: Env) -> Result<i128, Error> {
        let pool = Self::load_pool(&env)?;
        Ok(fp_div(pool.reserve_b, pool.reserve_a))
    }

    // ── Admin functions ───────────────────────────────────────────────────────

    /// Pause or unpause the pool.
    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        admin.require_auth();
        let mut pool = Self::load_pool(&env)?;
        if pool.admin != admin {
            return Err(Error::Unauthorized);
        }
        pool.paused = paused;
        Self::save_pool(&env, &pool);
        let sym = if paused {
            symbol_short!("paused")
        } else {
            symbol_short!("unpaused")
        };
        env.events()
            .publish((sym, symbol_short!("twamm")), (admin,));
        Ok(())
    }

    /// Update the LP fee (in basis points).
    pub fn set_fee(env: Env, admin: Address, fee_bps: u32) -> Result<(), Error> {
        admin.require_auth();
        let mut pool = Self::load_pool(&env)?;
        if pool.admin != admin {
            return Err(Error::Unauthorized);
        }
        if fee_bps > 1000 {
            return Err(Error::InvalidAmount);
        }
        pool.fee_bps = fee_bps;
        Self::save_pool(&env, &pool);
        Ok(())
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{testutils::Ledger, Env};

    fn setup() -> (Env, Address, TwammContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, TwammContract);
        let client = TwammContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        (env, admin, client)
    }

    #[test]
    fn test_initialize() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000, &2_000_000, &30)
            .unwrap();
        let pool = client.get_pool().unwrap();
        assert_eq!(pool.reserve_a, 1_000_000);
        assert_eq!(pool.reserve_b, 2_000_000);
        assert_eq!(pool.fee_bps, 30);
    }

    #[test]
    fn test_initialize_twice_fails() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000, &2_000_000, &30)
            .unwrap();
        assert_eq!(
            client.initialize(&admin, &1_000_000, &2_000_000, &30),
            Err(Ok(Error::AlreadyInitialized))
        );
    }

    #[test]
    fn test_spot_swap() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000, &1_000_000, &30)
            .unwrap();
        let trader = Address::generate(&env);
        let out = client.swap(&trader, &true, &10_000, &0).unwrap();
        assert!(out > 0 && out < 10_000);
        let pool = client.get_pool().unwrap();
        // Pool reserve A increased, B decreased.
        assert!(pool.reserve_a > 1_000_000);
        assert!(pool.reserve_b < 1_000_000);
    }

    #[test]
    fn test_submit_order() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000_000, &1_000_000_000, &30)
            .unwrap();
        let trader = Address::generate(&env);
        let id = client.submit_order(&trader, &true, &100_000, &100).unwrap();
        assert_eq!(id, 1);
        let order = client.get_order(&id).unwrap();
        assert_eq!(order.owner, trader);
        assert!(order.rate_per_ledger > 0);
        assert_eq!(order.status, OrderStatus::Active);
    }

    #[test]
    fn test_cancel_order_refund() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000_000, &1_000_000_000, &30)
            .unwrap();
        let trader = Address::generate(&env);
        // Submit order for 100 ledgers
        let id = client.submit_order(&trader, &true, &100_000, &100).unwrap();

        // Advance 50 ledgers (halfway)
        env.ledger().with_mut(|li| li.sequence_number += 50);

        let refund = client.cancel_order(&trader, &id).unwrap();
        // ~50% of 100_000 should be refunded (allow rounding)
        assert!(refund >= 49_000 && refund <= 51_000, "refund={}", refund);

        let order = client.get_order(&id).unwrap();
        assert_eq!(order.status, OrderStatus::Cancelled);
    }

    #[test]
    fn test_cancel_completed_order_fails() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000_000, &1_000_000_000, &30)
            .unwrap();
        let trader = Address::generate(&env);
        let id = client.submit_order(&trader, &true, &100_000, &10).unwrap();
        // Advance past expiry
        env.ledger().with_mut(|li| li.sequence_number += 20);
        client.settle_expired().unwrap();
        assert_eq!(
            client.cancel_order(&trader, &id),
            Err(Ok(Error::OrderNotActive))
        );
    }

    #[test]
    fn test_pause_blocks_swap() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000, &1_000_000, &30)
            .unwrap();
        client.set_paused(&admin, &true).unwrap();
        let trader = Address::generate(&env);
        assert_eq!(
            client.swap(&trader, &true, &1000, &0),
            Err(Ok(Error::Paused))
        );
    }

    #[test]
    fn test_settle_expired() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000_000, &1_000_000_000, &30)
            .unwrap();
        let trader = Address::generate(&env);
        client.submit_order(&trader, &true, &100_000, &5).unwrap();
        client.submit_order(&trader, &false, &50_000, &5).unwrap();
        // Advance past both orders
        env.ledger().with_mut(|li| li.sequence_number += 10);
        let settled = client.settle_expired().unwrap();
        assert_eq!(settled, 2);
    }

    #[test]
    fn test_lazy_virtual_order_affects_reserves() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000_000, &1_000_000_000, &30)
            .unwrap();
        let trader = Address::generate(&env);
        // Submit A→B TWAMM order (only one direction, simple linear path)
        client
            .submit_order(&trader, &true, &10_000_000, &100)
            .unwrap();

        let pool_before = client.get_pool().unwrap();
        // Advance 10 ledgers
        env.ledger().with_mut(|li| li.sequence_number += 10);

        // Trigger lazy evaluation via a swap
        client.swap(&trader, &false, &100, &0).unwrap();

        let pool_after = client.get_pool().unwrap();
        // A reserves should have increased (virtual A→B orders pushed A in)
        assert!(pool_after.reserve_a > pool_before.reserve_a);
    }

    #[test]
    fn test_spot_price() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000, &2_000_000, &30)
            .unwrap();
        // price of A in B = reserve_b / reserve_a = 2.0 (in fp)
        let price = client.spot_price().unwrap();
        assert_eq!(price, 2 * SCALE);
    }

    #[test]
    fn test_order_count() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000_000, &1_000_000_000, &30)
            .unwrap();
        assert_eq!(client.order_count(), 0);
        let trader = Address::generate(&env);
        client.submit_order(&trader, &true, &1_000, &5).unwrap();
        assert_eq!(client.order_count(), 1);
    }

    #[test]
    fn test_unauthorized_cancel() {
        let (env, admin, client) = setup();
        client
            .initialize(&admin, &1_000_000_000, &1_000_000_000, &30)
            .unwrap();
        let trader = Address::generate(&env);
        let attacker = Address::generate(&env);
        let id = client.submit_order(&trader, &true, &1_000, &10).unwrap();
        assert_eq!(
            client.cancel_order(&attacker, &id),
            Err(Ok(Error::Unauthorized))
        );
    }
}
