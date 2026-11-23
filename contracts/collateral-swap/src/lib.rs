// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Automated Collateral Swap Adapter for In-Flight Debt Migration
//!
//! Enables borrowers in lending pools to swap their underlying collateral asset
//! (e.g., XLM -> USDC) in a single atomic transaction without repaying debt first.
//! Executes flash loan borrowing, lending pool collateral substitution, DEX AMM swap,
//! flash loan repayment, and health factor validation.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    add_protocol_fees, get_admin, get_base_switch_fee_bps, get_deviation_fee_multiplier_bps,
    get_dex_rate, get_flash_loan_fee_bps, get_max_price_deviation_bps, get_protocol_fees,
    get_token_price, get_user_collateral, get_user_debt, is_initialized, set_admin,
    set_base_switch_fee_bps, set_deviation_fee_multiplier_bps, set_dex_rate,
    set_flash_loan_fee_bps, set_initialized, set_max_price_deviation_bps, set_token_price,
    set_user_collateral, set_user_debt,
};
use crate::types::{Error, PositionHealth, SwapParams, SwapResult};

pub const PRICE_SCALE: i128 = 10_000_000; // 1e7
pub const BPS_SCALE: i128 = 10_000;
pub const MIN_SOLVENT_HF_BPS: i128 = 10_000; // 1.0 minimum health factor
/// Hard ceiling for the total dynamic switching fee (10%).
pub const MAX_SWITCH_FEE_BPS: i128 = 1_000;
/// Upper bound accepted for the deviation fee multiplier (200%).
pub const MAX_DEVIATION_FEE_MULTIPLIER_BPS: i128 = 20_000;

#[contract]
pub struct CollateralSwapAdapter;

#[contractimpl]
impl CollateralSwapAdapter {
    pub fn initialize(env: Env, admin: Address, flash_fee_bps: i128) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        set_admin(&env, &admin);
        set_initialized(&env);
        set_flash_loan_fee_bps(&env, flash_fee_bps);

        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    pub fn set_flash_fee(env: Env, admin: Address, new_fee_bps: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if !(0..=1_000).contains(&new_fee_bps) {
            return Err(Error::InvalidAmount);
        }
        set_flash_loan_fee_bps(&env, new_fee_bps);
        Ok(())
    }

    pub fn set_token_price(
        env: Env,
        admin: Address,
        token: Address,
        price: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if price <= 0 {
            return Err(Error::InvalidAmount);
        }
        set_token_price(&env, &token, price);
        Ok(())
    }

    pub fn set_dex_rate(
        env: Env,
        admin: Address,
        from: Address,
        to: Address,
        rate_bps: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if rate_bps <= 0 {
            return Err(Error::InvalidAmount);
        }
        set_dex_rate(&env, &from, &to, rate_bps);
        Ok(())
    }

    /// Set the maximum tolerated deviation (bps) between the DEX rate and the
    /// oracle-implied rate before a swap is rejected.
    pub fn set_max_price_deviation(env: Env, admin: Address, bps: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if !(0..=BPS_SCALE).contains(&bps) {
            return Err(Error::InvalidAmount);
        }
        set_max_price_deviation_bps(&env, bps);
        Ok(())
    }

    /// Configure the dynamic switching fee: `base_bps` is always charged and
    /// `deviation_multiplier_bps` scales the observed price deviation into extra fee.
    /// The total fee is capped at [`MAX_SWITCH_FEE_BPS`].
    pub fn set_switch_fee_params(
        env: Env,
        admin: Address,
        base_bps: i128,
        deviation_multiplier_bps: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if !(0..=MAX_SWITCH_FEE_BPS).contains(&base_bps)
            || !(0..=MAX_DEVIATION_FEE_MULTIPLIER_BPS).contains(&deviation_multiplier_bps)
        {
            return Err(Error::InvalidAmount);
        }
        set_base_switch_fee_bps(&env, base_bps);
        set_deviation_fee_multiplier_bps(&env, deviation_multiplier_bps);
        Ok(())
    }

    pub fn get_protocol_fees(env: Env, token: Address) -> i128 {
        get_protocol_fees(&env, &token)
    }

    pub fn set_position(
        env: Env,
        admin: Address,
        user: Address,
        token: Address,
        collateral_amount: i128,
        debt_amount: i128,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_user_collateral(&env, &user, &token, collateral_amount);
        set_user_debt(&env, &user, debt_amount);
        Ok(())
    }

    /// Calculate user health factor: (collateral_value * 10_000) / debt_value
    pub fn get_health_factor(env: Env, user: Address, token: Address) -> PositionHealth {
        let col_amount = get_user_collateral(&env, &user, &token);
        let col_price = get_token_price(&env, &token);
        let col_value = (col_amount * col_price) / PRICE_SCALE;

        let debt_value = get_user_debt(&env, &user);

        let hf_bps = if debt_value <= 0 {
            999_999
        } else {
            (col_value * BPS_SCALE) / debt_value
        };

        PositionHealth {
            collateral_value: col_value,
            debt_value,
            health_factor_bps: hf_bps,
        }
    }

    /// Single atomic transaction to swap underlying collateral without repaying debt first:
    /// 1. Pre-flight health check and oracle price deviation guardrail
    /// 2. Flash borrow new collateral asset
    /// 3. Deposit new collateral into lending pool
    /// 4. Withdraw original collateral from lending pool
    /// 5. Swap original collateral on DEX to repay flash loan + fee
    /// 6. Post-flight health check (ensures HF_final >= HF_initial)
    pub fn execute_collateral_swap(env: Env, params: SwapParams) -> Result<SwapResult, Error> {
        Self::assert_initialized(&env)?;
        params.user.require_auth();

        if params.from_amount <= 0 || params.flash_borrow_amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let cur_from_col = get_user_collateral(&env, &params.user, &params.from_collateral);
        if cur_from_col < params.from_amount {
            return Err(Error::InsufficientLendingCollateral);
        }

        // 1. Initial health factor validation, valued over both tokens involved in the swap
        let initial_health = Self::position_health(
            &env,
            &params.user,
            &params.from_collateral,
            &params.to_collateral,
        );
        if initial_health.health_factor_bps < MIN_SOLVENT_HF_BPS {
            return Err(Error::InsolventPosition);
        }

        // 1b. Oracle price deviation guardrail: the DEX rate must stay close to the
        // rate implied by the oracle prices of the source and target collateral.
        let dex_rate = get_dex_rate(&env, &params.from_collateral, &params.to_collateral);
        let price_deviation_bps = Self::price_deviation_bps(
            &env,
            &params.from_collateral,
            &params.to_collateral,
            dex_rate,
        );
        if price_deviation_bps > get_max_price_deviation_bps(&env) {
            return Err(Error::PriceDeviationExceeded);
        }

        // 2. Flash loan borrowing
        let flash_fee_bps = get_flash_loan_fee_bps(&env);
        let flash_fee = (params.flash_borrow_amount * flash_fee_bps) / BPS_SCALE;
        let total_repay = params.flash_borrow_amount + flash_fee;

        // 3. Deposit new collateral into lending pool for user
        let cur_to_col = get_user_collateral(&env, &params.user, &params.to_collateral);
        let new_to_col = cur_to_col + params.flash_borrow_amount;
        set_user_collateral(&env, &params.user, &params.to_collateral, new_to_col);

        // 4. Withdraw original collateral from lending pool
        let updated_from_col = cur_from_col - params.from_amount;
        set_user_collateral(
            &env,
            &params.user,
            &params.from_collateral,
            updated_from_col,
        );

        // 5. Swap original collateral on DEX to repay flash loan
        let dex_output = (params.from_amount * dex_rate) / BPS_SCALE;

        if dex_output < params.min_dex_output {
            return Err(Error::SlippageExceeded);
        }

        // Dynamic switching fee: a base fee plus a share of the observed price deviation,
        // which makes predatory arbitrage against stale prices progressively more expensive.
        let switch_fee_bps = core::cmp::min(
            get_base_switch_fee_bps(&env)
                + (price_deviation_bps * get_deviation_fee_multiplier_bps(&env)) / BPS_SCALE,
            MAX_SWITCH_FEE_BPS,
        );
        let switch_fee = (dex_output * switch_fee_bps) / BPS_SCALE;

        if dex_output < total_repay + switch_fee {
            return Err(Error::FlashLoanRepaymentFailed);
        }
        if switch_fee > 0 {
            add_protocol_fees(&env, &params.to_collateral, switch_fee);
        }

        // Any surplus from swap is deposited as additional collateral
        let surplus = dex_output - total_repay - switch_fee;
        if surplus > 0 {
            let final_to_col =
                get_user_collateral(&env, &params.user, &params.to_collateral) + surplus;
            set_user_collateral(&env, &params.user, &params.to_collateral, final_to_col);
        }

        // 6. Post-flight health factor check: MUST be >= initial health factor
        let final_health = Self::position_health(
            &env,
            &params.user,
            &params.from_collateral,
            &params.to_collateral,
        );
        if final_health.health_factor_bps < initial_health.health_factor_bps {
            return Err(Error::HealthFactorDecreased);
        }
        if final_health.health_factor_bps < MIN_SOLVENT_HF_BPS {
            return Err(Error::InsolventPosition);
        }

        env.events().publish(
            (symbol_short!("col_swap"),),
            (
                params.user,
                params.from_amount,
                params.flash_borrow_amount,
                final_health.health_factor_bps,
            ),
        );

        Ok(SwapResult {
            from_collateral_withdrawn: params.from_amount,
            to_collateral_deposited: params.flash_borrow_amount + surplus,
            flash_loan_repaid: total_repay,
            initial_health_factor: initial_health.health_factor_bps,
            final_health_factor: final_health.health_factor_bps,
            switch_fee,
            price_deviation_bps,
        })
    }

    pub fn get_user_collateral(env: Env, user: Address, token: Address) -> i128 {
        get_user_collateral(&env, &user, &token)
    }

    pub fn get_user_debt(env: Env, user: Address) -> i128 {
        get_user_debt(&env, &user)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Health of the user's position valued across the two collateral tokens
    /// involved in a swap, against the user's total debt.
    fn position_health(
        env: &Env,
        user: &Address,
        token_a: &Address,
        token_b: &Address,
    ) -> PositionHealth {
        let value_a =
            (get_user_collateral(env, user, token_a) * get_token_price(env, token_a)) / PRICE_SCALE;
        let value_b =
            (get_user_collateral(env, user, token_b) * get_token_price(env, token_b)) / PRICE_SCALE;
        let collateral_value = value_a + value_b;
        let debt_value = get_user_debt(env, user);
        let health_factor_bps = if debt_value <= 0 {
            999_999
        } else {
            (collateral_value * BPS_SCALE) / debt_value
        };
        PositionHealth {
            collateral_value,
            debt_value,
            health_factor_bps,
        }
    }

    /// Absolute deviation (bps) of the DEX rate from the oracle-implied rate
    /// `price_from / price_to` (both in bps terms).
    fn price_deviation_bps(env: &Env, from: &Address, to: &Address, dex_rate_bps: i128) -> i128 {
        let oracle_rate_bps = (get_token_price(env, from) * BPS_SCALE) / get_token_price(env, to);
        if oracle_rate_bps <= 0 {
            return BPS_SCALE;
        }
        let diff = if dex_rate_bps > oracle_rate_bps {
            dex_rate_bps - oracle_rate_bps
        } else {
            oracle_rate_bps - dex_rate_bps
        };
        (diff * BPS_SCALE) / oracle_rate_bps
    }

    fn assert_admin(env: &Env, admin: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        admin.require_auth();
        let stored_admin = get_admin(env)?;
        if stored_admin != *admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }
}
