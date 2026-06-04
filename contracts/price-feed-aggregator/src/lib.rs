// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Price Feed Aggregator Contract
//!
//! Combines prices from multiple on-chain reporters into a single reliable
//! price for a given asset pair (e.g. "XLM/USD").
//!
//! ## Aggregation strategies
//! - **Median** – middle value of sorted active prices (default, outlier-robust)
//! - **WeightedAverage** – weighted mean using per-source weights
//! - **TrimmedMean** – drops bottom/top `trim_pct` % before averaging
//!
//! ## Security
//! - Only the designated `reporter` of each source may update its price.
//! - Stale prices (older than `max_price_age`) are excluded from aggregation.
//! - Outlier detection rejects prices deviating > `outlier_bps` from the median.
//! - Circuit breaker rejects a price update that moves a source by > `circuit_breaker_bps`.
//! - Admin-controlled emergency pause.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Env, String, Vec};

use crate::storage::*;
use crate::types::{AggregatedPrice, AggregationStrategy, Error, PriceSource};

#[contract]
pub struct PriceFeedAggregator;

#[contractimpl]
impl PriceFeedAggregator {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract (callable once).
    ///
    /// * `asset`              – human-readable asset label, e.g. "XLM/USD"
    /// * `decimals`           – price scaling factor (default 7 → prices are × 10^7)
    /// * `max_price_age`      – seconds before a price is stale (default 3600)
    /// * `outlier_bps`        – outlier rejection threshold in bps (default 2000 = 20%)
    /// * `circuit_breaker_bps`– max single-update swing per source in bps (default 3000)
    /// * `strategy`           – aggregation strategy (default Median)
    pub fn initialize(
        env: Env,
        admin: Address,
        asset: String,
        decimals: Option<u32>,
        max_price_age: Option<u64>,
        outlier_bps: Option<u32>,
        circuit_breaker_bps: Option<u32>,
        strategy: Option<AggregationStrategy>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.storage().instance().set(&crate::types::InstanceKey::Asset, &asset);
        if let Some(d) = decimals { set_decimals(&env, d); }
        if let Some(a) = max_price_age { set_max_price_age(&env, a); }
        if let Some(o) = outlier_bps { set_outlier_bps(&env, o); }
        if let Some(c) = circuit_breaker_bps { set_circuit_breaker_bps(&env, c); }
        if let Some(s) = strategy { set_strategy(&env, s); }
        env.events().publish((symbol_short!("init"),), (admin, asset));
        Ok(())
    }

    // ── Admin: pause / unpause ────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), admin);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), admin);
        Ok(())
    }

    // ── Source management ─────────────────────────────────────────────────────

    /// Register a new price source. Returns the assigned source ID.
    pub fn add_source(
        env: Env,
        admin: Address,
        reporter: Address,
        description: String,
        weight: Option<u32>,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let w = weight.unwrap_or(1);
        if w == 0 || w > 100 {
            return Err(Error::InvalidWeight);
        }
        let id = get_source_count(&env);
        let source = PriceSource {
            reporter: reporter.clone(),
            description,
            weight: w,
            last_price: 0,
            last_updated: 0,
            active: true,
        };
        set_source(&env, id, &source);
        set_source_count(&env, id + 1);
        env.events().publish((symbol_short!("srcadd"),), (id, reporter));
        Ok(id)
    }

    /// Deactivate a price source (non-destructive).
    pub fn remove_source(env: Env, admin: Address, source_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut source = get_source(&env, source_id)?;
        source.active = false;
        set_source(&env, source_id, &source);
        env.events().publish((symbol_short!("srcrm"),), source_id);
        Ok(())
    }

    /// Update the weight of a source (1–100).
    pub fn set_weight(
        env: Env,
        admin: Address,
        source_id: u32,
        weight: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if weight == 0 || weight > 100 {
            return Err(Error::InvalidWeight);
        }
        let mut source = get_source(&env, source_id)?;
        source.weight = weight;
        set_source(&env, source_id, &source);
        Ok(())
    }

    // ── Price updates ─────────────────────────────────────────────────────────

    /// Submit a new price for a specific source.
    ///
    /// Only the `reporter` registered for that source may call this.
    /// Rejected if:
    /// - contract is paused
    /// - source is inactive
    /// - `price` ≤ 0
    /// - price swing exceeds `circuit_breaker_bps` (relative to the previous price)
    pub fn update_price(
        env: Env,
        reporter: Address,
        source_id: u32,
        price: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        reporter.require_auth();

        if price <= 0 {
            return Err(Error::InvalidPrice);
        }
        let mut source = get_source(&env, source_id)?;
        if !source.active {
            return Err(Error::SourceInactive);
        }
        if source.reporter != reporter {
            return Err(Error::Unauthorized);
        }

        // Circuit-breaker check (skip when no previous price yet)
        if source.last_price > 0 {
            let cb_bps = get_circuit_breaker_bps(&env) as i128;
            let deviation = abs_diff(price, source.last_price) * 10_000 / source.last_price;
            if deviation > cb_bps {
                return Err(Error::CircuitBreakerTripped);
            }
        }

        source.last_price = price;
        source.last_updated = env.ledger().timestamp();
        set_source(&env, source_id, &source);

        env.events().publish((symbol_short!("priceupd"),), (source_id, price));
        Ok(())
    }

    // ── Price reads ───────────────────────────────────────────────────────────

    /// Get the raw price and metadata for a single source.
    pub fn get_price(env: Env, source_id: u32) -> Result<PriceSource, Error> {
        ensure_initialized(&env)?;
        get_source(&env, source_id)
    }

    /// Aggregate all active, non-stale prices into a single value.
    ///
    /// Requires at least 1 valid source. Applies outlier detection before
    /// aggregating when more than 2 sources are available.
    pub fn get_aggregated_price(env: Env) -> Result<AggregatedPrice, Error> {
        ensure_initialized(&env)?;
        let count = get_source_count(&env);
        let now = env.ledger().timestamp();
        let max_age = get_max_price_age(&env);
        let strategy = get_strategy(&env);
        let outlier_bps = get_outlier_bps(&env) as i128;

        // Collect valid (active + fresh) prices and their weights
        let mut prices: Vec<i128> = vec![&env];
        let mut weights: Vec<u32> = vec![&env];

        let mut id: u32 = 0;
        while id < count {
            if let Ok(src) = get_source(&env, id) {
                let age = now.saturating_sub(src.last_updated);
                if src.active && src.last_price > 0 && age <= max_age {
                    prices.push_back(src.last_price);
                    weights.push_back(src.weight);
                }
            }
            id += 1;
        }

        if prices.is_empty() {
            return Err(Error::InsufficientSources);
        }

        // Outlier detection: filter prices > outlier_bps from the median
        if prices.len() > 2 {
            let med = median(&prices);
            let mut filtered_prices: Vec<i128> = vec![&env];
            let mut filtered_weights: Vec<u32> = vec![&env];
            let mut i: u32 = 0;
            while i < prices.len() {
                let p = prices.get(i).unwrap();
                let w = weights.get(i).unwrap();
                let dev = abs_diff(p, med) * 10_000 / med;
                if dev <= outlier_bps {
                    filtered_prices.push_back(p);
                    filtered_weights.push_back(w);
                }
                i += 1;
            }
            if !filtered_prices.is_empty() {
                prices = filtered_prices;
                weights = filtered_weights;
            }
        }

        let num_sources = prices.len();
        let price = match strategy {
            AggregationStrategy::Median => median(&prices),
            AggregationStrategy::WeightedAverage => weighted_average(&prices, &weights),
            AggregationStrategy::TrimmedMean => {
                let pct = get_trim_pct(&env);
                trimmed_mean(&prices, pct)
            }
        };

        Ok(AggregatedPrice { price, num_sources, timestamp: now })
    }

    // ── Admin: config setters ─────────────────────────────────────────────────

    pub fn set_strategy(env: Env, admin: Address, strategy: AggregationStrategy) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_strategy(&env, strategy);
        Ok(())
    }

    pub fn set_max_price_age(env: Env, admin: Address, max_age: u64) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if max_age == 0 { return Err(Error::InvalidParameter); }
        set_max_price_age(&env, max_age);
        Ok(())
    }

    pub fn set_outlier_bps(env: Env, admin: Address, bps: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if bps == 0 || bps > 10_000 { return Err(Error::InvalidParameter); }
        set_outlier_bps(&env, bps);
        Ok(())
    }

    pub fn set_circuit_breaker_bps(env: Env, admin: Address, bps: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if bps == 0 || bps > 10_000 { return Err(Error::InvalidParameter); }
        set_circuit_breaker_bps(&env, bps);
        Ok(())
    }

    // ── Read-only config ──────────────────────────────────────────────────────

    pub fn get_source_count(env: Env) -> u32 {
        get_source_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) { return Err(Error::NotInitialized); }
    Ok(())
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) { return Err(Error::ContractPaused); }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller { return Err(Error::Unauthorized); }
    Ok(())
}

fn abs_diff(a: i128, b: i128) -> i128 {
    if a > b { a - b } else { b - a }
}

/// In-place insertion sort (small N, no_std safe). Uses u32 indices (soroban Vec::len returns u32).
fn sort_vec(v: &mut Vec<i128>) {
    let n = v.len();
    let mut i: u32 = 1;
    while i < n {
        let key = v.get(i).unwrap();
        let mut j = i;
        while j > 0 && v.get(j - 1).unwrap() > key {
            let prev = v.get(j - 1).unwrap();
            v.set(j, prev);
            j -= 1;
        }
        v.set(j, key);
        i += 1;
    }
}

fn median(prices: &Vec<i128>) -> i128 {
    let mut sorted = prices.clone();
    sort_vec(&mut sorted);
    let n = sorted.len();
    if n % 2 == 1 {
        sorted.get(n / 2).unwrap()
    } else {
        let lo = sorted.get(n / 2 - 1).unwrap();
        let hi = sorted.get(n / 2).unwrap();
        (lo + hi) / 2
    }
}

fn weighted_average(prices: &Vec<i128>, weights: &Vec<u32>) -> i128 {
    let mut sum: i128 = 0;
    let mut total_weight: i128 = 0;
    let mut i: u32 = 0;
    while i < prices.len() {
        let p = prices.get(i).unwrap();
        let w = weights.get(i).unwrap() as i128;
        sum += p * w;
        total_weight += w;
        i += 1;
    }
    if total_weight == 0 { return 0; }
    sum / total_weight
}

fn trimmed_mean(prices: &Vec<i128>, trim_pct: u32) -> i128 {
    let mut sorted = prices.clone();
    sort_vec(&mut sorted);
    let n = sorted.len();
    let trim = n * trim_pct / 100;
    let lo = trim;
    let hi = n - trim;
    if lo >= hi {
        // fallback: plain average
        let mut sum: i128 = 0;
        let mut i: u32 = 0;
        while i < n { sum += sorted.get(i).unwrap(); i += 1; }
        return sum / n as i128;
    }
    let mut sum: i128 = 0;
    let mut i = lo;
    while i < hi { sum += sorted.get(i).unwrap(); i += 1; }
    sum / (hi - lo) as i128
}
