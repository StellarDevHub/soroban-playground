#![no_std]

mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
use crate::storage::{get_admin, get_config, get_tier_count, set_admin, set_config, set_tiers, add_snapshot, get_last_update, set_last_update};
use crate::types::{InterestRateConfig, RateQuery, PoolUtilization, CurveType, RateTier, RateSnapshot};

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

    pub fn compute_rate(env: Env, borrowed: i128, total_available: i128) -> RateQuery {
        let config = get_config(&env).expect("Not initialized");
        // Compute utilization in basis points (0-10000)
        let utilization_bps: u32 = if total_available == 0 {
            0
        } else {
            let util = (borrowed * 10_000) / total_available;
            if util < 0 { 0 } else { util as u32 }
        };

        let current_rate = match config.curve_type {
            CurveType::Linear => {
                let rate = config.base_rate_bps as u128 + ((utilization_bps as u128 * config.multiplier_bps as u128) / 10_000u128);
                let capped = if rate > config.max_rate_bps as u128 { config.max_rate_bps } else { rate as u32 };
                capped
            }
            CurveType::Exponential => {
                // Simple exponential approximation: base + multiplier * (util^2 / 10000)
                let util_sq = (utilization_bps as u128 * utilization_bps as u128) / 10_000u128;
                let rate = config.base_rate_bps as u128 + ((util_sq * config.multiplier_bps as u128) / 10_000u128);
                let capped = if rate > config.max_rate_bps as u128 { config.max_rate_bps } else { rate as u32 };
                capped
            }
        };

        let projected = None;

        // record snapshot
        let snapshot = RateSnapshot { timestamp: env.ledger().timestamp(), rate_bps: current_rate, utilization_bps };
        add_snapshot(&env, &snapshot);
        set_last_update(&env, env.ledger().timestamp());

        RateQuery { current_rate_bps: current_rate, utilization_bps, projected_rate_bps: projected }
    }

    pub fn set_tiered_rates(env: Env, admin: Address, tiers: Vec<RateTier>) {
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
