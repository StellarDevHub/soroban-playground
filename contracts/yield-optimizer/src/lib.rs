// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Cross-Protocol Yield Optimizer
//!
//! Extends basic yield farming with:
//! - Multi-strategy portfolio allocation with configurable weights.
//! - Auto-compounding per user position.
//! - On-chain strategy backtesting simulation.
//! - Optimal strategy recommendation (highest active APY).
//! - Emergency pause/unpause.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String, Vec};

use crate::storage::{
    get_admin, get_advanced_strategy, get_position, get_strategy, get_strategy_count,
    has_advanced_strategy, has_position, has_strategy, is_initialized, is_paused, remove_position,
    set_admin, set_advanced_strategy, set_paused, set_position, set_strategy, set_strategy_count,
};
use crate::types::{
    AdvancedStrategy, Allocation, BacktestResult, CompoundResult, Error, Position, RebalanceResult,
    Strategy, StrategyScore,
};

const SECS_PER_YEAR: u64 = 31_536_000;
const BPS: u32 = 10_000;
const MAX_APY_BPS: u32 = 50_000; // 500%
const MAX_RISK_SCORE: u32 = 100;
const RISK_PENALTY_DIVISOR: u32 = 1_000;

#[contract]
pub struct YieldOptimizer;

#[contractimpl]
impl YieldOptimizer {
    // ── Lifecycle ─────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_strategy_count(&env, 0);
        env.events().publish((symbol_short!("init"),), (admin,));
        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    // ── Strategy management ───────────────────────────────────────────────────

    /// Register a new strategy. Returns its ID.
    pub fn add_strategy(
        env: Env,
        admin: Address,
        name: String,
        apy_bps: u32,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.is_empty() {
            return Err(Error::EmptyName);
        }
        if apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        let id = get_strategy_count(&env) + 1;
        set_strategy(
            &env,
            id,
            &Strategy {
                name: name.clone(),
                apy_bps,
                total_deposited: 0,
                is_active: true,
                last_compound_ts: env.ledger().timestamp(),
            },
        );
        set_strategy_count(&env, id);
        env.events()
            .publish((symbol_short!("strat_add"), id), (name, apy_bps));
        Ok(id)
    }

    pub fn update_apy(
        env: Env,
        admin: Address,
        strategy_id: u32,
        new_apy_bps: u32,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if new_apy_bps > MAX_APY_BPS {
            return Err(Error::InvalidApy);
        }
        let mut s = get_strategy(&env, strategy_id)?;
        s.apy_bps = new_apy_bps;
        set_strategy(&env, strategy_id, &s);
        env.events()
            .publish((symbol_short!("apy_upd"), strategy_id), new_apy_bps);
        Ok(())
    }

    pub fn set_strategy_active(
        env: Env,
        admin: Address,
        strategy_id: u32,
        active: bool,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut s = get_strategy(&env, strategy_id)?;
        s.is_active = active;
        set_strategy(&env, strategy_id, &s);
        env.events()
            .publish((symbol_short!("strat_tog"), strategy_id), active);
        Ok(())
    }

    /// Attach optimizer metadata to a strategy without changing the legacy
    /// strategy record. Fees apply to rewards, harvest cost is a fixed amount,
    /// and risk is used only for strategy scoring/allocation.
    pub fn configure_advanced_strategy(
        env: Env,
        admin: Address,
        strategy_id: u32,
        protocol: String,
        fee_bps: u32,
        harvest_cost: i128,
        min_compound_gain_bps: u32,
        risk_score: u32,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        get_strategy(&env, strategy_id)?;
        Self::validate_advanced_profile(
            &protocol,
            fee_bps,
            harvest_cost,
            min_compound_gain_bps,
            risk_score,
        )?;
        let profile = AdvancedStrategy {
            strategy_id,
            protocol,
            fee_bps,
            harvest_cost,
            min_compound_gain_bps,
            risk_score,
        };
        set_advanced_strategy(&env, strategy_id, &profile);
        env.events()
            .publish((symbol_short!("adv_cfg"), strategy_id), profile);
        Ok(())
    }

    // ── User actions ──────────────────────────────────────────────────────────

    pub fn deposit(env: Env, user: Address, strategy_id: u32, amount: i128) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut s = get_strategy(&env, strategy_id)?;
        if !s.is_active {
            return Err(Error::StrategyPaused);
        }
        let now = env.ledger().timestamp();
        let mut pos = if has_position(&env, strategy_id, &user) {
            Self::accrue(get_position(&env, strategy_id, &user)?, &s, now)
        } else {
            Position {
                deposited: 0,
                compounded_balance: 0,
                last_update_ts: now,
            }
        };
        pos.deposited += amount;
        pos.compounded_balance += amount;
        pos.last_update_ts = now;
        s.total_deposited += amount;
        set_position(&env, strategy_id, &user, &pos);
        set_strategy(&env, strategy_id, &s);
        env.events()
            .publish((symbol_short!("deposit"), strategy_id), (user, amount));
        Ok(())
    }

    pub fn withdraw(
        env: Env,
        user: Address,
        strategy_id: u32,
        amount: i128,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        user.require_auth();
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut s = get_strategy(&env, strategy_id)?;
        let now = env.ledger().timestamp();
        let mut pos = Self::accrue(get_position(&env, strategy_id, &user)?, &s, now);
        if amount > pos.compounded_balance {
            return Err(Error::InsufficientBalance);
        }
        pos.compounded_balance -= amount;
        pos.deposited -= amount.min(pos.deposited);
        s.total_deposited -= amount.min(s.total_deposited);
        pos.last_update_ts = now;
        if pos.compounded_balance == 0 {
            remove_position(&env, strategy_id, &user);
        } else {
            set_position(&env, strategy_id, &user, &pos);
        }
        set_strategy(&env, strategy_id, &s);
        env.events()
            .publish((symbol_short!("withdraw"), strategy_id), (user, amount));
        Ok(amount)
    }

    /// Trigger auto-compounding for a user's position. Callable by anyone (keeper).
    pub fn compound(env: Env, user: Address, strategy_id: u32) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        let mut s = get_strategy(&env, strategy_id)?;
        let now = env.ledger().timestamp();
        let pos = Self::accrue(get_position(&env, strategy_id, &user)?, &s, now);
        let bal = pos.compounded_balance;
        s.last_compound_ts = now;
        set_position(&env, strategy_id, &user, &pos);
        set_strategy(&env, strategy_id, &s);
        env.events()
            .publish((symbol_short!("compound"), strategy_id), (user, bal));
        Ok(bal)
    }

    /// Compound only when the net reward is positive after strategy fees,
    /// harvest cost, and the configured minimum-gain threshold.
    pub fn compound_profitably(
        env: Env,
        user: Address,
        strategy_id: u32,
    ) -> Result<CompoundResult, Error> {
        Self::assert_not_paused(&env)?;
        let mut s = get_strategy(&env, strategy_id)?;
        if !s.is_active {
            return Err(Error::StrategyPaused);
        }
        let profile = Self::advanced_profile_or_default(&env, strategy_id, &s)?;
        let now = env.ledger().timestamp();
        let pos = get_position(&env, strategy_id, &user)?;
        let (new_pos, result) = Self::compound_preview(pos, &s, &profile, now)?;
        s.last_compound_ts = now;
        set_position(&env, strategy_id, &user, &new_pos);
        set_strategy(&env, strategy_id, &s);
        env.events()
            .publish((symbol_short!("compound"), strategy_id), result.clone());
        Ok(result)
    }

    /// Preview the profitable-compound path without mutating position state.
    pub fn preview_compound(
        env: Env,
        user: Address,
        strategy_id: u32,
    ) -> Result<CompoundResult, Error> {
        let s = get_strategy(&env, strategy_id)?;
        let profile = Self::advanced_profile_or_default(&env, strategy_id, &s)?;
        let pos = get_position(&env, strategy_id, &user)?;
        let (_, result) = Self::compound_preview(pos, &s, &profile, env.ledger().timestamp())?;
        Ok(result)
    }

    /// Allocate `total_amount` across strategies according to weights.
    /// Validates weights sum to BPS (10 000) and all strategies are active.
    /// Returns per-strategy deposit amounts (simulation only — no actual token transfer).
    pub fn allocate(
        env: Env,
        allocations: Vec<Allocation>,
        total_amount: i128,
    ) -> Result<Vec<i128>, Error> {
        if total_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let mut weight_sum: u32 = 0;
        for a in allocations.iter() {
            get_strategy(&env, a.strategy_id)?; // existence check
            weight_sum = weight_sum.saturating_add(a.weight_bps);
        }
        if weight_sum != BPS {
            return Err(Error::InvalidWeights);
        }
        let mut amounts = Vec::new(&env);
        for a in allocations.iter() {
            let amt = total_amount.saturating_mul(a.weight_bps as i128) / BPS as i128;
            amounts.push_back(amt);
        }
        Ok(amounts)
    }

    /// Return the ID of the active strategy with the highest APY.
    pub fn best_strategy(env: Env) -> Result<u32, Error> {
        Self::assert_initialized(&env)?;
        let count = get_strategy_count(&env);
        let mut best_id: u32 = 0;
        let mut best_apy: u32 = 0;
        for i in 1..=count {
            if !has_strategy(&env, i) {
                continue;
            }
            if let Ok(s) = get_strategy(&env, i) {
                if s.is_active && s.apy_bps > best_apy {
                    best_apy = s.apy_bps;
                    best_id = i;
                }
            }
        }
        if best_id == 0 {
            return Err(Error::StrategyNotFound);
        }
        Ok(best_id)
    }

    /// Return the active strategy with the highest risk-adjusted net APY.
    pub fn best_advanced_strategy(env: Env, max_risk_score: u32) -> Result<u32, Error> {
        Self::assert_initialized(&env)?;
        if max_risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRisk);
        }
        let count = get_strategy_count(&env);
        let mut best_id: u32 = 0;
        let mut best_net_apy: u32 = 0;
        for i in 1..=count {
            if !has_strategy(&env, i) {
                continue;
            }
            let s = get_strategy(&env, i)?;
            if !s.is_active {
                continue;
            }
            let profile = Self::advanced_profile_or_default(&env, i, &s)?;
            if profile.risk_score > max_risk_score {
                continue;
            }
            let score = Self::score_strategy(i, &s, &profile);
            if score.net_apy_bps > best_net_apy {
                best_id = i;
                best_net_apy = score.net_apy_bps;
            }
        }
        if best_id == 0 {
            return Err(Error::NoOptimizableStrategy);
        }
        Ok(best_id)
    }

    /// Allocate capital across active strategies proportionally to their
    /// risk-adjusted net APY. Returned weights always sum to 10 000 bps.
    pub fn optimize_allocation(
        env: Env,
        total_amount: i128,
        max_risk_score: u32,
    ) -> Result<Vec<Allocation>, Error> {
        if total_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if max_risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRisk);
        }

        let count = get_strategy_count(&env);
        let mut total_score: u32 = 0;
        let mut best_id: u32 = 0;
        let mut best_net_apy: u32 = 0;
        for i in 1..=count {
            if !has_strategy(&env, i) {
                continue;
            }
            let s = get_strategy(&env, i)?;
            if !s.is_active {
                continue;
            }
            let profile = Self::advanced_profile_or_default(&env, i, &s)?;
            if profile.risk_score > max_risk_score {
                continue;
            }
            let score = Self::score_strategy(i, &s, &profile);
            if score.net_apy_bps == 0 {
                continue;
            }
            total_score = total_score.saturating_add(score.net_apy_bps);
            if score.net_apy_bps > best_net_apy {
                best_id = i;
                best_net_apy = score.net_apy_bps;
            }
        }

        if total_score == 0 || best_id == 0 {
            return Err(Error::NoOptimizableStrategy);
        }

        let mut floor_weight_sum: u32 = 0;
        for i in 1..=count {
            if !has_strategy(&env, i) {
                continue;
            }
            let s = get_strategy(&env, i)?;
            if !s.is_active {
                continue;
            }
            let profile = Self::advanced_profile_or_default(&env, i, &s)?;
            if profile.risk_score > max_risk_score {
                continue;
            }
            let net_apy_bps = Self::score_strategy(i, &s, &profile).net_apy_bps;
            if net_apy_bps == 0 {
                continue;
            }
            floor_weight_sum =
                floor_weight_sum.saturating_add(net_apy_bps.saturating_mul(BPS) / total_score);
        }
        let residual = BPS.saturating_sub(floor_weight_sum);

        let mut allocations = Vec::new(&env);
        for i in 1..=count {
            if !has_strategy(&env, i) {
                continue;
            }
            let s = get_strategy(&env, i)?;
            if !s.is_active {
                continue;
            }
            let profile = Self::advanced_profile_or_default(&env, i, &s)?;
            if profile.risk_score > max_risk_score {
                continue;
            }
            let net_apy_bps = Self::score_strategy(i, &s, &profile).net_apy_bps;
            if net_apy_bps == 0 {
                continue;
            }
            let mut weight_bps = net_apy_bps.saturating_mul(BPS) / total_score;
            if i == best_id {
                weight_bps = weight_bps.saturating_add(residual);
            }
            allocations.push_back(Allocation {
                strategy_id: i,
                weight_bps,
            });
        }

        Ok(allocations)
    }

    /// Move a user's full accrued position into the best active net-yielding
    /// strategy when that strategy improves the risk-adjusted APY.
    pub fn rebalance_to_best(
        env: Env,
        user: Address,
        from_strategy_id: u32,
        max_risk_score: u32,
    ) -> Result<RebalanceResult, Error> {
        Self::assert_not_paused(&env)?;
        user.require_auth();
        let to_strategy_id = Self::best_advanced_strategy(env.clone(), max_risk_score)?;
        if to_strategy_id == from_strategy_id {
            return Err(Error::NoOptimizableStrategy);
        }

        let mut from_strategy = get_strategy(&env, from_strategy_id)?;
        let mut to_strategy = get_strategy(&env, to_strategy_id)?;
        if !from_strategy.is_active || !to_strategy.is_active {
            return Err(Error::StrategyPaused);
        }

        let from_profile =
            Self::advanced_profile_or_default(&env, from_strategy_id, &from_strategy)?;
        let to_profile = Self::advanced_profile_or_default(&env, to_strategy_id, &to_strategy)?;
        let previous_net_apy_bps =
            Self::score_strategy(from_strategy_id, &from_strategy, &from_profile).net_apy_bps;
        let new_net_apy_bps =
            Self::score_strategy(to_strategy_id, &to_strategy, &to_profile).net_apy_bps;
        if new_net_apy_bps <= previous_net_apy_bps {
            return Err(Error::NoOptimizableStrategy);
        }

        let now = env.ledger().timestamp();
        let from_pos = Self::accrue(
            get_position(&env, from_strategy_id, &user)?,
            &from_strategy,
            now,
        );
        let moved_amount = from_pos.compounded_balance;
        if moved_amount <= 0 {
            return Err(Error::ZeroAmount);
        }

        let moved_deposited = from_pos.deposited.min(moved_amount);
        from_strategy.total_deposited = from_strategy
            .total_deposited
            .saturating_sub(moved_deposited.min(from_strategy.total_deposited));
        to_strategy.total_deposited = to_strategy.total_deposited.saturating_add(moved_amount);

        let mut to_pos = if has_position(&env, to_strategy_id, &user) {
            Self::accrue(
                get_position(&env, to_strategy_id, &user)?,
                &to_strategy,
                now,
            )
        } else {
            Position {
                deposited: 0,
                compounded_balance: 0,
                last_update_ts: now,
            }
        };
        to_pos.deposited = to_pos.deposited.saturating_add(moved_amount);
        to_pos.compounded_balance = to_pos.compounded_balance.saturating_add(moved_amount);
        to_pos.last_update_ts = now;

        remove_position(&env, from_strategy_id, &user);
        set_position(&env, to_strategy_id, &user, &to_pos);
        set_strategy(&env, from_strategy_id, &from_strategy);
        set_strategy(&env, to_strategy_id, &to_strategy);

        let result = RebalanceResult {
            from_strategy_id,
            to_strategy_id,
            moved_amount,
            previous_net_apy_bps,
            new_net_apy_bps,
        };
        env.events().publish(
            (symbol_short!("rebalance"), from_strategy_id),
            result.clone(),
        );
        Ok(result)
    }

    /// Simulate historical performance of a strategy over `duration_secs`.
    /// Pure computation — no state changes.
    pub fn backtest(
        env: Env,
        strategy_id: u32,
        initial_amount: i128,
        duration_secs: u64,
    ) -> Result<BacktestResult, Error> {
        if initial_amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        if duration_secs == 0 {
            return Err(Error::InvalidDuration);
        }
        let s = get_strategy(&env, strategy_id)?;
        // Compound annually: final = initial * (1 + apy)^years
        // Approximated with continuous compounding in integer arithmetic:
        // reward = initial * apy_bps * duration / (BPS * SECS_PER_YEAR)
        let reward = (initial_amount as i128)
            .saturating_mul(s.apy_bps as i128)
            .saturating_mul(duration_secs as i128)
            / (BPS as i128 * SECS_PER_YEAR as i128);
        let final_amount = initial_amount.saturating_add(reward);
        let gain = final_amount - initial_amount;
        // effective_apy_bps = gain * BPS * SECS_PER_YEAR / (initial * duration)
        let effective_apy_bps = if initial_amount > 0 {
            (gain
                .saturating_mul(BPS as i128)
                .saturating_mul(SECS_PER_YEAR as i128)
                / (initial_amount as i128 * duration_secs as i128)) as u32
        } else {
            0
        };
        Ok(BacktestResult {
            strategy_id,
            initial_amount,
            final_amount,
            gain,
            effective_apy_bps,
            duration_secs,
        })
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_strategy(env: Env, strategy_id: u32) -> Result<Strategy, Error> {
        get_strategy(&env, strategy_id)
    }

    pub fn get_advanced_strategy(env: Env, strategy_id: u32) -> Result<AdvancedStrategy, Error> {
        let s = get_strategy(&env, strategy_id)?;
        Self::advanced_profile_or_default(&env, strategy_id, &s)
    }

    pub fn strategy_score(env: Env, strategy_id: u32) -> Result<StrategyScore, Error> {
        let s = get_strategy(&env, strategy_id)?;
        let profile = Self::advanced_profile_or_default(&env, strategy_id, &s)?;
        Ok(Self::score_strategy(strategy_id, &s, &profile))
    }

    pub fn strategy_count(env: Env) -> u32 {
        get_strategy_count(&env)
    }

    pub fn get_position(env: Env, user: Address, strategy_id: u32) -> Result<Position, Error> {
        let s = get_strategy(&env, strategy_id)?;
        let pos = get_position(&env, strategy_id, &user)?;
        Ok(Self::accrue(pos, &s, env.ledger().timestamp()))
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn list_strategies(env: Env) -> Vec<u32> {
        let count = get_strategy_count(&env);
        let mut ids = Vec::new(&env);
        for i in 1..=count {
            if has_strategy(&env, i) {
                ids.push_back(i);
            }
        }
        ids
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fn accrue(mut pos: Position, s: &Strategy, now: u64) -> Position {
        let elapsed = now.saturating_sub(pos.last_update_ts);
        if elapsed == 0 || s.apy_bps == 0 || pos.compounded_balance == 0 {
            return pos;
        }
        let reward = pos
            .compounded_balance
            .saturating_mul(s.apy_bps as i128)
            .saturating_mul(elapsed as i128)
            / (BPS as i128 * SECS_PER_YEAR as i128);
        pos.compounded_balance = pos.compounded_balance.saturating_add(reward);
        pos.last_update_ts = now;
        pos
    }

    fn advanced_profile_or_default(
        env: &Env,
        strategy_id: u32,
        s: &Strategy,
    ) -> Result<AdvancedStrategy, Error> {
        if has_advanced_strategy(env, strategy_id) {
            return get_advanced_strategy(env, strategy_id);
        }
        Ok(AdvancedStrategy {
            strategy_id,
            protocol: s.name.clone(),
            fee_bps: 0,
            harvest_cost: 0,
            min_compound_gain_bps: 0,
            risk_score: 0,
        })
    }

    fn validate_advanced_profile(
        protocol: &String,
        fee_bps: u32,
        harvest_cost: i128,
        min_compound_gain_bps: u32,
        risk_score: u32,
    ) -> Result<(), Error> {
        if protocol.is_empty() {
            return Err(Error::EmptyName);
        }
        if fee_bps > BPS {
            return Err(Error::InvalidFee);
        }
        if harvest_cost < 0 {
            return Err(Error::InvalidHarvestCost);
        }
        if min_compound_gain_bps > BPS {
            return Err(Error::InvalidThreshold);
        }
        if risk_score > MAX_RISK_SCORE {
            return Err(Error::InvalidRisk);
        }
        Ok(())
    }

    fn score_strategy(strategy_id: u32, s: &Strategy, profile: &AdvancedStrategy) -> StrategyScore {
        let fee_drag_bps = s.apy_bps.saturating_mul(profile.fee_bps) / BPS;
        let risk_penalty_bps = s.apy_bps.saturating_mul(profile.risk_score) / RISK_PENALTY_DIVISOR;
        let net_apy_bps = s
            .apy_bps
            .saturating_sub(fee_drag_bps)
            .saturating_sub(risk_penalty_bps);
        StrategyScore {
            strategy_id,
            gross_apy_bps: s.apy_bps,
            fee_bps: profile.fee_bps,
            risk_score: profile.risk_score,
            risk_penalty_bps,
            net_apy_bps,
            harvest_cost: profile.harvest_cost,
            min_compound_gain_bps: profile.min_compound_gain_bps,
        }
    }

    fn compound_preview(
        mut pos: Position,
        s: &Strategy,
        profile: &AdvancedStrategy,
        now: u64,
    ) -> Result<(Position, CompoundResult), Error> {
        let previous_balance = pos.compounded_balance;
        let elapsed = now.saturating_sub(pos.last_update_ts);
        let gross_reward = if elapsed == 0 || s.apy_bps == 0 || previous_balance == 0 {
            0
        } else {
            previous_balance
                .saturating_mul(s.apy_bps as i128)
                .saturating_mul(elapsed as i128)
                / (BPS as i128 * SECS_PER_YEAR as i128)
        };
        let fee_amount = gross_reward.saturating_mul(profile.fee_bps as i128) / BPS as i128;
        let net_reward = gross_reward
            .saturating_sub(fee_amount)
            .saturating_sub(profile.harvest_cost);
        let min_gain =
            previous_balance.saturating_mul(profile.min_compound_gain_bps as i128) / BPS as i128;

        if net_reward <= 0 || net_reward < min_gain {
            return Err(Error::UnprofitableCompound);
        }

        pos.compounded_balance = previous_balance.saturating_add(net_reward);
        pos.last_update_ts = now;
        Ok((
            pos,
            CompoundResult {
                strategy_id: profile.strategy_id,
                previous_balance,
                gross_reward,
                fee_amount,
                harvest_cost: profile.harvest_cost,
                net_reward,
                compounded_balance: previous_balance.saturating_add(net_reward),
            },
        ))
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
        if *caller != get_admin(env)? {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }
}
