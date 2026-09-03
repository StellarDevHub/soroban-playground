#![no_std]

mod math;
mod storage;
mod types;

#[cfg(test)]
mod proptest;
#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use crate::math::{compute_exponential_rate, compute_linear_rate, compute_utilization_bps};
use crate::storage::{get_admin, get_config, get_tier_count, set_admin, set_config, set_tiers, add_snapshot, get_last_update, set_last_update};
use crate::types::{InterestRateConfig, RateQuery, PoolUtilization, CurveType, RateTier, RateSnapshot, Error};

#[contract]
pub struct InterestRateModel;

#[contractimpl]
impl InterestRateModel {
    pub fn initialize(env: Env, admin: Address, base_rate_bps: u32, multiplier_bps: u32, max_rate_bps: u32, curve: CurveType) {
        if storage::is_initialized(&env) {
            panic!("Already initialized");
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_config(&env, &InterestRateConfig { base_rate_bps, multiplier_bps, max_rate_bps, curve_type: curve });
        storage::set_initialized(&env);
        set_last_update(&env, env.ledger().timestamp());
    }

    pub fn compute_rate(env: Env, borrowed: i128, total_available: i128) -> Result<RateQuery, Error> {
        let config = get_config(&env).ok_or(Error::NotInitialized)?;

        // Compute utilization and the current rate with safe-math helpers so
        // that overflow / division-by-zero surface as contract errors instead
        // of panicking or silently wrapping.
        let utilization_bps = compute_utilization_bps(borrowed, total_available)?;

        let current_rate = match config.curve_type {
            CurveType::Linear => compute_linear_rate(
                config.base_rate_bps,
                config.multiplier_bps,
                utilization_bps,
                config.max_rate_bps,
            )?,
            CurveType::Exponential => compute_exponential_rate(
                config.base_rate_bps,
                config.multiplier_bps,
                utilization_bps,
                config.max_rate_bps,
            )?,
        };

        let projected = None;

        // record snapshot
        let snapshot = RateSnapshot { timestamp: env.ledger().timestamp(), rate_bps: current_rate, utilization_bps };
        add_snapshot(&env, &snapshot);
        set_last_update(&env, env.ledger().timestamp());

        Ok(RateQuery { current_rate_bps: current_rate, utilization_bps, projected_rate_bps: projected })
    }

    pub fn set_tiered_rates(env: Env, admin: Address, tiers: Vec<RateTier>) {
        let stored_admin = get_admin(&env).expect("Not initialized");
        if admin != stored_admin {
            panic!("Unauthorized: caller is not the admin");
        }
        admin.require_auth();
        // basic validation
        let max = tiers.len();
        if max > 20 { panic!("Too many tiers"); }
        // ensure thresholds ascending
        let mut prev: u32 = 0;
        for i in 0..tiers.len() {
            let t = tiers.get(i).unwrap();
            if t.threshold_bps <= prev { panic!("Invalid tier threshold"); }
            prev = t.threshold_bps;
        }
        set_tiers(&env, &tiers);
    }

    pub fn get_config(env: Env) -> Option<InterestRateConfig> {
        get_config(&env)
    }

    pub fn last_update(env: Env) -> u64 {
        get_last_update(&env)
    }
}
