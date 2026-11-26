// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Price Feed Aggregator Contract
//!
//! Returns the median of at least three distinct, admin-bound reporters.
//! Each asset requires configured positive inclusive price bounds.
//!
//! ## Security features
//! - Outlier detection: sources whose price deviates more than `outlier_bps`
//!   from the median are excluded before aggregation.
//! - Circuit breaker: if the new aggregated price deviates more than
//!   `circuit_breaker_bps` from the last accepted price, the update is
//!   rejected to guard against manipulation.
//! - Staleness check: prices older than `max_price_age` seconds are ignored.
//! - Source authorization: only admin-authorized source IDs may submit prices.
//!
//! ## Lifecycle
//! 1. Admin calls `initialize`.
//! 2. Admin registers sources with `add_source`, binds each with `set_reporter`,
//!    and configures each asset with `set_price_bounds`.
//! 3. Authorized sources call `update_price` periodically.
//! 4. Consumers call `get_aggregated_price` to get the current result.
//! 5. Admin may `pause`/`unpause` in emergencies.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_circuit_breaker_bps, get_last_aggregated, get_max_price_age, get_min_sources,
    get_outlier_bps, get_price, get_price_bounds, get_reporter, get_source, get_source_count,
    get_strategy, is_authorized, is_initialized, is_paused, set_admin, set_authorized,
    set_circuit_breaker_bps, set_last_aggregated, set_max_price_age, set_min_sources,
    set_outlier_bps, set_paused, set_price, set_price_bounds, set_reporter, set_source,
    set_source_count, set_strategy,
};
use crate::types::{AggregatedPrice, AggregationStrategy, Error, PriceBounds, PriceEntry, Source};

// Maximum number of registered sources to bound computation.
const MAX_SOURCES: u32 = 32;

#[contract]
pub struct PriceAggregator;

#[contractimpl]
impl PriceAggregator {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the contract. Can only be called once.
    ///
    /// - `strategy`: only Median is accepted.
    /// - `max_price_age`: seconds before a price is considered stale (default: 3600).
    /// - `outlier_bps`: deviation threshold in basis points to detect outliers (default: 2000 = 20%).
    /// - `circuit_breaker_bps`: max allowed price swing vs last aggregate before rejecting (default: 5000 = 50%).
    /// - `min_sources`: minimum valid sources required to produce an aggregated price (default: 3, minimum: 3).
    pub fn initialize(
        env: Env,
        admin: Address,
        strategy: Option<AggregationStrategy>,
        max_price_age: Option<u64>,
        outlier_bps: Option<u32>,
        circuit_breaker_bps: Option<u32>,
        min_sources: Option<u32>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        if strategy.unwrap_or(AggregationStrategy::Median) != AggregationStrategy::Median
            || max_price_age.is_some_and(|age| age == 0 || age > 3600)
            || min_sources.is_some_and(|count| !(3..=MAX_SOURCES).contains(&count))
            || outlier_bps.is_some_and(|bps| bps == 0 || bps > 10_000)
            || circuit_breaker_bps.is_some_and(|bps| bps == 0 || bps > 10_000)
        {
            return Err(Error::InvalidParameter);
        }
        set_admin(&env, &admin);
        if let Some(s) = strategy {
            set_strategy(&env, s);
        }
        if let Some(age) = max_price_age {
            set_max_price_age(&env, age);
        }
        if let Some(bps) = outlier_bps {
            set_outlier_bps(&env, bps);
        }
        if let Some(bps) = circuit_breaker_bps {
            set_circuit_breaker_bps(&env, bps);
        }
        if let Some(ms) = min_sources {
            set_min_sources(&env, ms);
        }
        env.events().publish((symbol_short!("init"),), admin);
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

    /// Register a new price source. Returns the new source ID.
    pub fn add_source(env: Env, admin: Address, name: String, weight: u32) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if name.is_empty() {
            return Err(Error::EmptyAsset);
        }
        if weight == 0 || weight > 100 {
            return Err(Error::InvalidWeight);
        }
        let count = get_source_count(&env);
        if count >= MAX_SOURCES {
            return Err(Error::MaxSourcesReached);
        }
        let id = count;
        let source = Source {
            id,
            name,
            weight,
            active: true,
        };
        set_source(&env, &source);
        set_authorized(&env, id, true);
        set_source_count(&env, count + 1);
        env.events().publish((symbol_short!("srcAdd"),), id);
        Ok(id)
    }

    /// Deactivate a source (it can no longer submit prices).
    pub fn remove_source(env: Env, admin: Address, source_id: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut source = get_source(&env, source_id)?;
        source.active = false;
        set_source(&env, &source);
        set_authorized(&env, source_id, false);
        env.events().publish((symbol_short!("srcRm"),), source_id);
        Ok(())
    }

    /// Update the weight for a source (1–100). Retained as metadata; the median is unweighted.
    pub fn set_weight(env: Env, admin: Address, source_id: u32, weight: u32) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if weight == 0 || weight > 100 {
            return Err(Error::InvalidWeight);
        }
        let mut source = get_source(&env, source_id)?;
        source.weight = weight;
        set_source(&env, &source);
        Ok(())
    }

    /// Change the aggregation strategy.
    pub fn set_strategy(
        env: Env,
        admin: Address,
        strategy: AggregationStrategy,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if strategy != AggregationStrategy::Median {
            return Err(Error::InvalidParameter);
        }
        set_strategy(&env, strategy);
        Ok(())
    }

    /// Bind a source ID to its reporter once, before its first submission.
    /// To rotate a reporter, remove the source and register a new source ID.
    pub fn set_reporter(
        env: Env,
        admin: Address,
        source_id: u32,
        reporter: Address,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if !get_source(&env, source_id)?.active {
            return Err(Error::SourceInactive);
        }
        if get_reporter(&env, source_id).is_some() {
            return Err(Error::ReporterAlreadySet);
        }
        for id in 0..get_source_count(&env) {
            if let Ok(source) = get_source(&env, id) {
                if source.active && get_reporter(&env, id) == Some(reporter.clone()) {
                    return Err(Error::DuplicateReporter);
                }
            }
        }
        set_reporter(&env, source_id, &reporter);
        Ok(())
    }

    /// Configure inclusive bounds for one asset, in its 18-decimal price scale.
    pub fn set_price_bounds(
        env: Env,
        admin: Address,
        asset: String,
        min: i128,
        max: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if asset.is_empty() {
            return Err(Error::EmptyAsset);
        }
        if min <= 0 || max < min {
            return Err(Error::InvalidParameter);
        }
        set_price_bounds(&env, &asset, &PriceBounds { min, max });
        Ok(())
    }

    // ── Price submission ──────────────────────────────────────────────────────

    /// Submit a price for an asset. Must be called by an authorized source.
    ///
    /// `price` must be scaled to 18 decimal places (price × 10^18).
    pub fn update_price(
        env: Env,
        source_addr: Address,
        source_id: u32,
        asset: String,
        price: i128,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        source_addr.require_auth();

        if !is_authorized(&env, source_id) || get_reporter(&env, source_id) != Some(source_addr) {
            return Err(Error::Unauthorized);
        }
        let source = get_source(&env, source_id)?;
        if !source.active {
            return Err(Error::SourceInactive);
        }
        if asset.is_empty() {
            return Err(Error::EmptyAsset);
        }
        validate_price(price, &get_price_bounds(&env, &asset)?)?;

        let entry = PriceEntry {
            price,
            timestamp: env.ledger().timestamp(),
            source_id,
        };
        set_price(&env, source_id, &asset, &entry);
        env.events()
            .publish((symbol_short!("priceUp"),), (source_id, asset, price));
        Ok(())
    }

    // ── Price queries ─────────────────────────────────────────────────────────

    /// Return the most recent price from a single source. Errors if stale.
    pub fn get_price(env: Env, source_id: u32, asset: String) -> Result<PriceEntry, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        let source = get_source(&env, source_id)?;
        if !source.active {
            return Err(Error::SourceInactive);
        }
        if get_reporter(&env, source_id).is_none() {
            return Err(Error::Unauthorized);
        }
        let entry = get_price(&env, source_id, &asset).ok_or(Error::SourceNotFound)?;
        validate_price(entry.price, &get_price_bounds(&env, &asset)?)?;
        if !is_fresh(
            env.ledger().timestamp(),
            entry.timestamp,
            get_max_price_age(&env),
        ) {
            return Err(Error::PriceStale);
        }
        Ok(entry)
    }

    /// Compute and return the aggregated price for an asset.
    ///
    /// Applies freshness and bounds checks, then outlier filtering and median
    /// aggregation with at least three distinct reporters. Checks the circuit breaker against the last
    /// accepted aggregated price before persisting.
    pub fn get_aggregated_price(env: Env, asset: String) -> Result<AggregatedPrice, Error> {
        ensure_initialized(&env)?;
        if asset.is_empty() {
            return Err(Error::EmptyAsset);
        }

        not_paused(&env)?;
        let strategy = get_strategy(&env);
        if strategy != AggregationStrategy::Median {
            return Err(Error::InvalidParameter);
        }
        let bounds = get_price_bounds(&env, &asset)?;
        let now = env.ledger().timestamp();
        let mut oldest = now;
        let mut prices: Vec<i128> = vec![&env];
        let mut reporters: Vec<Address> = vec![&env];
        for id in 0..get_source_count(&env) {
            let Ok(source) = get_source(&env, id) else {
                continue;
            };
            let Some(reporter) = get_reporter(&env, id) else {
                continue;
            };
            let Some(entry) = get_price(&env, id, &asset) else {
                continue;
            };
            if !source.active
                || !is_authorized(&env, id)
                || reporters.contains(&reporter)
                || !is_fresh(now, entry.timestamp, get_max_price_age(&env))
                || validate_price(entry.price, &bounds).is_err()
            {
                continue;
            }
            reporters.push_back(reporter);
            prices.push_back(entry.price);
            oldest = oldest.min(entry.timestamp);
        }
        let min_required = get_min_sources(&env);
        if prices.len() < min_required {
            return Err(Error::InsufficientSources);
        }
        sort_prices(&mut prices);
        let med = median(&prices);
        let mut filtered: Vec<i128> = vec![&env];
        for price in prices.iter() {
            if !exceeds_deviation(price, med, get_outlier_bps(&env)) {
                filtered.push_back(price);
            }
        }
        if filtered.len() < min_required {
            return Err(Error::InsufficientSources);
        }
        let fn_len = filtered.len();
        let aggregated = median(&filtered);
        if let Some(last) = get_last_aggregated(&env, &asset) {
            if last > 0 && exceeds_deviation(aggregated, last, get_circuit_breaker_bps(&env)) {
                return Err(Error::CircuitBreakerTripped);
            }
        }
        set_last_aggregated(&env, &asset, aggregated);

        let result = AggregatedPrice {
            asset: asset.clone(),
            price: aggregated,
            timestamp: oldest,
            num_sources: fn_len,
            strategy,
        };
        env.events()
            .publish((symbol_short!("aggPrice"),), (asset, aggregated, fn_len));
        Ok(result)
    }

    // ── Read-only helpers ─────────────────────────────────────────────────────

    pub fn get_source(env: Env, source_id: u32) -> Result<Source, Error> {
        ensure_initialized(&env)?;
        get_source(&env, source_id)
    }

    pub fn get_source_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_source_count(&env))
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn get_strategy(env: Env) -> Result<AggregationStrategy, Error> {
        ensure_initialized(&env)?;
        Ok(get_strategy(&env))
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn abs_diff(a: i128, b: i128) -> i128 {
    if a > b {
        a - b
    } else {
        b - a
    }
}

fn validate_price(price: i128, bounds: &PriceBounds) -> Result<(), Error> {
    if price <= 0 {
        return Err(Error::InvalidPrice);
    }
    if price < bounds.min || price > bounds.max {
        return Err(Error::PriceOutOfBounds);
    }
    Ok(())
}

fn is_fresh(now: u64, timestamp: u64, max_age: u64) -> bool {
    now.checked_sub(timestamp).is_some_and(|age| age <= max_age)
}

fn exceeds_deviation(price: i128, reference: i128, bps: u32) -> bool {
    let bps = bps.min(10_000) as i128;
    let allowed = (reference / 10_000) * bps + (reference % 10_000) * bps / 10_000;
    abs_diff(price, reference) > allowed
}

fn sort_prices(prices: &mut Vec<i128>) {
    for i in 1..prices.len() {
        let mut j = i;
        while j > 0 && prices.get(j - 1).unwrap() > prices.get(j).unwrap() {
            let a = prices.get(j - 1).unwrap();
            let b = prices.get(j).unwrap();
            prices.set(j - 1, b);
            prices.set(j, a);
            j -= 1;
        }
    }
}

// Caller provides sorted, positive prices; subtraction avoids sum overflow.
fn median(prices: &Vec<i128>) -> i128 {
    let mid = prices.len() / 2;
    let hi = prices.get(mid).unwrap();
    if prices.len() % 2 == 1 {
        hi
    } else {
        let lo = prices.get(mid - 1).unwrap();
        lo + (hi - lo) / 2
    }
}
