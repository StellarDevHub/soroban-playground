// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # TWAP Oracle
//!
//! Provides manipulation-resistant Time-Weighted Average Price (TWAP) feeds:
//! - Whitelisted feeders submit spot-price observations for registered assets.
//! - Each observation records the spot price and a running cumulative
//!   (price × elapsed-seconds) used for efficient TWAP computation.
//! - `get_twap` returns the TWAP over a caller-specified window of seconds
//!   by interpolating between stored observations.
//! - Admin controls: pause, feeder whitelist, asset registration, staleness cap.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_asset, get_asset_count, get_asset_id_by_symbol, get_observations, is_feeder,
    is_initialized, is_paused, push_observation, set_admin, set_asset, set_asset_count,
    set_asset_symbol_index, set_feeder, set_paused,
};
use crate::types::{AssetConfig, Error, Observation, TwapResult};

/// Maximum observations stored per asset.
const MAX_OBSERVATIONS: u32 = 200;
/// Default TWAP window when none is supplied (1 hour).
const DEFAULT_WINDOW_SECS: u64 = 3_600;

#[contract]
pub struct TwapOracle;

#[contractimpl]
impl TwapOracle {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_paused(&env, false);
        set_asset_count(&env, 0);
        Ok(())
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, paused);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    pub fn set_feeder(env: Env, admin: Address, feeder: Address, active: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_feeder(&env, &feeder, active);
        env.events()
            .publish((symbol_short!("feeder"),), (feeder, active));
        Ok(())
    }

    /// Register a new asset. Returns the assigned asset_id.
    pub fn register_asset(
        env: Env,
        admin: Address,
        symbol: String,
        max_staleness: u64,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if symbol.len() == 0 {
            return Err(Error::EmptyAssetId);
        }
        if max_staleness == 0 {
            return Err(Error::InvalidWindow);
        }
        let id = get_asset_count(&env) + 1;
        let config = AssetConfig {
            symbol: symbol.clone(),
            max_staleness,
            is_active: true,
        };
        set_asset(&env, id, &config);
        set_asset_symbol_index(&env, &symbol, id);
        set_asset_count(&env, id);
        env.events().publish((symbol_short!("asset_reg"),), (id, symbol));
        Ok(id)
    }

    pub fn deactivate_asset(env: Env, admin: Address, asset_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut config = get_asset(&env, asset_id)?;
        config.is_active = false;
        set_asset(&env, asset_id, &config);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    // ── Price submission ──────────────────────────────────────────────────────

    /// Submit a spot price for an asset. Price must be > 0 (scaled by 10^7).
    pub fn submit_price(
        env: Env,
        feeder: Address,
        asset_id: u32,
        price: i128,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        if is_paused(&env) {
            return Err(Error::OraclePaused);
        }
        feeder.require_auth();
        if !is_feeder(&env, &feeder) {
            return Err(Error::UnknownFeeder);
        }
        if price <= 0 {
            return Err(Error::InvalidPrice);
        }
        let config = get_asset(&env, asset_id)?;
        if !config.is_active {
            return Err(Error::AssetNotFound);
        }

        let now = env.ledger().timestamp();
        let obs_list = get_observations(&env, asset_id);
        let cumulative = if obs_list.len() == 0 {
            0
        } else {
            let last = obs_list.last().unwrap();
            let elapsed = now.saturating_sub(last.timestamp) as i128;
            last.cumulative_price.saturating_add(last.price.saturating_mul(elapsed))
        };

        let obs = Observation {
            feeder: feeder.clone(),
            price,
            timestamp: now,
            cumulative_price: cumulative,
        };

        push_observation(&env, asset_id, obs, MAX_OBSERVATIONS);

        env.events()
            .publish((symbol_short!("price"), asset_id), (feeder, price, now));
        Ok(())
    }

    // ── TWAP computation ──────────────────────────────────────────────────────

    /// Compute the TWAP for `asset_id` over the last `window_secs` seconds.
    ///
    /// Uses the cumulative price stored in observations to calculate:
    ///   TWAP = Δ(cumulative_price) / Δ(time)
    /// across the window. Returns an error if there are fewer than 2 observations
    /// within the requested window.
    pub fn get_twap(env: Env, asset_id: u32, window_secs: u64) -> Result<TwapResult, Error> {
        Self::assert_initialized(&env)?;
        let _ = get_asset(&env, asset_id)?;

        let window = if window_secs == 0 { DEFAULT_WINDOW_SECS } else { window_secs };
        let now = env.ledger().timestamp();
        let window_start = now.saturating_sub(window);

        let all = get_observations(&env, asset_id);
        if all.len() < 2 {
            return Err(Error::InsufficientObservations);
        }

        // Find the oldest observation that falls within the window.
        let mut start_obs: Option<Observation> = None;
        let mut end_obs: Option<Observation> = None;
        let mut count: u32 = 0;

        for obs in all.iter() {
            if obs.timestamp >= window_start {
                if start_obs.is_none() {
                    start_obs = Some(obs.clone());
                }
                end_obs = Some(obs.clone());
                count += 1;
            }
        }

        let start = match start_obs {
            Some(o) => o,
            None => return Err(Error::InsufficientObservations),
        };
        let end = match end_obs {
            Some(o) => o,
            None => return Err(Error::InsufficientObservations),
        };

        if count < 2 || end.timestamp <= start.timestamp {
            return Err(Error::InsufficientObservations);
        }

        let elapsed = (end.timestamp - start.timestamp) as i128;
        let cum_delta = end.cumulative_price - start.cumulative_price;
        let twap_price = cum_delta / elapsed;

        Ok(TwapResult {
            price: twap_price,
            window_start: start.timestamp,
            window_end: end.timestamp,
            observation_count: count,
        })
    }

    /// Get all stored observations for an asset (up to MAX_OBSERVATIONS).
    pub fn get_observations(env: Env, asset_id: u32) -> Result<Vec<Observation>, Error> {
        let _ = get_asset(&env, asset_id)?;
        Ok(get_observations(&env, asset_id))
    }

    /// Get the latest spot price for an asset.
    pub fn get_latest_price(env: Env, asset_id: u32) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        let _ = get_asset(&env, asset_id)?;
        let obs = get_observations(&env, asset_id);
        if obs.len() == 0 {
            return Err(Error::InsufficientObservations);
        }
        Ok(obs.last().unwrap().price)
    }

    /// Look up an asset_id by its symbol string.
    pub fn get_asset_id(env: Env, symbol: String) -> Result<u32, Error> {
        get_asset_id_by_symbol(&env, &symbol).ok_or(Error::AssetNotFound)
    }

    pub fn get_asset_config(env: Env, asset_id: u32) -> Result<AssetConfig, Error> {
        get_asset(&env, asset_id)
    }

    pub fn is_feeder(env: Env, feeder: Address) -> bool {
        is_feeder(&env, &feeder)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
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
