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

mod proptest;
mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

use crate::storage::{
    get_admin, get_collection_stats, get_dynamic_fee_config, get_fee_bps, get_floor_price,
    get_last_ts, get_lp, get_nft_collection, get_price_a_cum, get_price_b_cum, get_reserve_a,
    get_reserve_b, get_token_a, get_token_b, get_total_fees, get_total_lp, get_total_volume,
    get_volatility_state, is_initialized, remove_dynamic_fee_config, set_admin,
    set_collection_stats, set_dynamic_fee_config, set_fee_bps, set_floor_price, set_last_ts,
    set_lp, set_nft_collection, set_price_a_cum, set_price_b_cum, set_reserve_a, set_reserve_b,
    set_token_a, set_token_b, set_total_fees, set_total_lp, set_total_volume, set_volatility_state,
};
pub use crate::types::{CollectionStats, DynamicFeeConfig, Error, SwapQuote, VolatilityState};

/// Minimum liquidity permanently locked on first deposit.
const MIN_LIQUIDITY: i128 = 1_000;
/// Precision multiplier for TWAP accumulators.
const TWAP_PRECISION: i128 = 1_000_000;
/// Precision used for direction-independent spot-price observations.
const PRICE_PRECISION: i128 = 10_000_000;
const BPS: i128 = 10_000;

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
        if token_a == token_b {
            return Err(Error::InvalidToken);
        }
        let configured_fee = fee_bps.unwrap_or(30);
        validate_fee(configured_fee)?;
        set_admin(&env, &admin);
        set_token_a(&env, &token_a);
        set_token_b(&env, &token_b);
        set_fee_bps(&env, configured_fee);
        set_last_ts(&env, env.ledger().timestamp());
        Ok(())
    }

    /// Enable or update the volatility/utilization-adjusted fee model.
    /// Existing pools remain fixed-fee until their admin opts in here.
    pub fn configure_dynamic_fees(
        env: Env,
        admin: Address,
        config: DynamicFeeConfig,
    ) -> Result<(), Error> {
        ensure_admin(&env, &admin)?;
        validate_dynamic_config(&config)?;
        set_dynamic_fee_config(&env, &config);

        let ra = get_reserve_a(&env);
        let rb = get_reserve_b(&env);
        let mut state = get_volatility_state(&env);
        if state.last_price == 0 && ra > 0 && rb > 0 {
            state.last_price = spot_price(ra, rb)?;
            state.last_timestamp = env.ledger().timestamp();
            set_volatility_state(&env, &state);
        }
        env.events().publish((symbol_short!("dynfee"),), config);
        Ok(())
    }

    /// Return to the pool's original fixed fee without deleting observations.
    pub fn disable_dynamic_fees(env: Env, admin: Address) -> Result<(), Error> {
        ensure_admin(&env, &admin)?;
        remove_dynamic_fee_config(&env);
        env.events().publish((symbol_short!("dynfee"),), false);
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

        let stats = CollectionStats {
            floor_price: 0,
            ceiling_price: 0,
            total_volume: 0,
            trade_count: 0,
            unique_holders: 0,
            last_update: env.ledger().timestamp(),
        };
        set_collection_stats(&env, &stats);

        env.events()
            .publish((symbol_short!("nft_init"),), nft_collection);
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
        execute_swap(&env, &token_in, amount_in, min_out, None, None)
    }

    /// Swap with protection against both output slippage and a fee increase
    /// between quote and execution. `deadline` is a ledger timestamp.
    pub fn swap_with_limits(
        env: Env,
        trader: Address,
        token_in: Address,
        amount_in: i128,
        min_out: i128,
        max_fee_bps: i128,
        deadline: u64,
    ) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        trader.require_auth();
        execute_swap(
            &env,
            &token_in,
            amount_in,
            min_out,
            Some(max_fee_bps),
            Some(deadline),
        )
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    /// Preview output for a swap without state changes.
    pub fn get_amount_out(env: Env, amount_in: i128, token_in: Address) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        let (ra, rb, _) = reserves_for_token_in(&env, &token_in)?;
        Ok(build_swap_quote(&env, amount_in, ra, rb)?.amount_out)
    }

    /// Preview output, effective fee, impact, volatility, and utilization.
    pub fn quote_dynamic_swap(
        env: Env,
        amount_in: i128,
        token_in: Address,
    ) -> Result<SwapQuote, Error> {
        ensure_initialized(&env)?;
        let (ra, rb, _) = reserves_for_token_in(&env, &token_in)?;
        build_swap_quote(&env, amount_in, ra, rb)
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
        Ok((
            get_price_a_cum(&env),
            get_price_b_cum(&env),
            get_last_ts(&env),
        ))
    }

    pub fn get_fee_bps(env: Env) -> Result<i128, Error> {
        ensure_initialized(&env)?;
        Ok(get_fee_bps(&env))
    }

    pub fn get_dynamic_fee_config(env: Env) -> Result<Option<DynamicFeeConfig>, Error> {
        ensure_initialized(&env)?;
        Ok(get_dynamic_fee_config(&env))
    }

    pub fn get_volatility_state(env: Env) -> Result<VolatilityState, Error> {
        ensure_initialized(&env)?;
        Ok(get_volatility_state(&env))
    }

    // ── NFT Collection Analytics ──────────────────────────────────────────────

    /// Get current collection statistics.
    pub fn get_collection_stats(env: Env) -> Result<CollectionStats, Error> {
        ensure_initialized(&env)?;
        get_collection_stats(&env).ok_or(Error::NotInitialized)
    }

    /// Update floor price based on swap activity.
    pub fn update_floor_price(env: Env, admin: Address, new_floor: i128) -> Result<(), Error> {
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

        env.events()
            .publish((symbol_short!("floor_upd"),), new_floor);
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

    /// Returns the NFT collection address when this pool was initialized as an NFT AMM.
    pub fn get_nft_collection(env: Env) -> Result<Option<Address>, Error> {
        ensure_initialized(&env)?;
        Ok(get_nft_collection(&env))
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn ensure_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    ensure_initialized(env)?;
    admin.require_auth();
    if get_admin(env)? != *admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

fn validate_fee(fee_bps: i128) -> Result<(), Error> {
    if !(0..BPS).contains(&fee_bps) {
        return Err(Error::InvalidFee);
    }
    Ok(())
}

fn validate_dynamic_config(config: &DynamicFeeConfig) -> Result<(), Error> {
    if config.min_fee_bps < 0
        || config.max_fee_bps >= BPS
        || config.min_fee_bps > config.max_fee_bps
        || !(0..=BPS).contains(&config.volatility_multiplier_bps)
        || !(0..=BPS).contains(&config.utilization_multiplier_bps)
        || !(1..=BPS).contains(&config.ema_alpha_bps)
        || config.volatility_window == 0
        || !(1..=BPS).contains(&config.max_price_impact_bps)
    {
        return Err(Error::InvalidDynamicFeeConfig);
    }
    Ok(())
}

/// Resolve live reserve balances for a swap input token.
fn reserves_for_token_in(env: &Env, token_in: &Address) -> Result<(i128, i128, bool), Error> {
    let token_a = get_token_a(env)?;
    let token_b = get_token_b(env)?;
    if token_in == &token_a {
        Ok((get_reserve_a(env), get_reserve_b(env), true))
    } else if token_in == &token_b {
        Ok((get_reserve_b(env), get_reserve_a(env), false))
    } else {
        Err(Error::InvalidToken)
    }
}

fn record_swap_metrics(env: &Env, amount_in: i128, fee_bps: i128) -> Result<(), Error> {
    let fee_amount = amount_in.checked_mul(fee_bps).ok_or(Error::Overflow)? / 10_000;
    set_total_volume(
        env,
        get_total_volume(env)
            .checked_add(amount_in)
            .ok_or(Error::Overflow)?,
    );
    set_total_fees(
        env,
        get_total_fees(env)
            .checked_add(fee_amount)
            .ok_or(Error::Overflow)?,
    );
    Ok(())
}

fn decayed_volatility(env: &Env, config: &DynamicFeeConfig) -> Result<i128, Error> {
    let state = get_volatility_state(env);
    let elapsed = env
        .ledger()
        .timestamp()
        .saturating_sub(state.last_timestamp);
    if elapsed >= config.volatility_window {
        return Ok(0);
    }
    state
        .ema_volatility_bps
        .checked_mul((config.volatility_window - elapsed) as i128)
        .and_then(|value| value.checked_div(config.volatility_window as i128))
        .ok_or(Error::Overflow)
}

fn utilization_bps(amount_in: i128, reserve_in: i128) -> Result<i128, Error> {
    let denominator = reserve_in.checked_add(amount_in).ok_or(Error::Overflow)?;
    amount_in
        .checked_mul(BPS)
        .and_then(|value| value.checked_div(denominator))
        .ok_or(Error::Overflow)
}

fn effective_fee(
    env: &Env,
    amount_in: i128,
    reserve_in: i128,
) -> Result<(i128, i128, i128), Error> {
    let utilization = utilization_bps(amount_in, reserve_in)?;
    let Some(config) = get_dynamic_fee_config(env) else {
        return Ok((get_fee_bps(env), 0, utilization));
    };
    let volatility = decayed_volatility(env, &config)?;
    let volatility_fee = volatility
        .checked_mul(config.volatility_multiplier_bps)
        .and_then(|value| value.checked_div(BPS))
        .ok_or(Error::Overflow)?;
    let utilization_fee = utilization
        .checked_mul(config.utilization_multiplier_bps)
        .and_then(|value| value.checked_div(BPS))
        .ok_or(Error::Overflow)?;
    let fee = get_fee_bps(env)
        .checked_add(volatility_fee)
        .and_then(|value| value.checked_add(utilization_fee))
        .ok_or(Error::Overflow)?
        .clamp(config.min_fee_bps, config.max_fee_bps);
    Ok((fee, volatility, utilization))
}

fn build_swap_quote(
    env: &Env,
    amount_in: i128,
    reserve_in: i128,
    reserve_out: i128,
) -> Result<SwapQuote, Error> {
    if amount_in <= 0 {
        return Err(Error::ZeroAmount);
    }
    if reserve_in <= 0 || reserve_out <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let (fee_bps, volatility_bps, utilization_bps) = effective_fee(env, amount_in, reserve_in)?;
    let amount_out = constant_product_amount_out(amount_in, reserve_in, reserve_out, fee_bps)?;
    if amount_out == 0 {
        return Err(Error::ZeroOutput);
    }
    let ideal_out = amount_in
        .checked_mul(reserve_out)
        .and_then(|value| value.checked_div(reserve_in))
        .ok_or(Error::Overflow)?;
    let price_impact_bps = if ideal_out == 0 || amount_out >= ideal_out {
        0
    } else {
        ideal_out
            .checked_sub(amount_out)
            .and_then(|difference| difference.checked_mul(BPS))
            .and_then(|value| value.checked_div(ideal_out))
            .ok_or(Error::Overflow)?
    };
    Ok(SwapQuote {
        amount_out,
        fee_bps,
        price_impact_bps,
        volatility_bps,
        utilization_bps,
    })
}

fn execute_swap(
    env: &Env,
    token_in: &Address,
    amount_in: i128,
    min_out: i128,
    max_fee_bps: Option<i128>,
    deadline: Option<u64>,
) -> Result<i128, Error> {
    if deadline.is_some_and(|value| env.ledger().timestamp() > value) {
        return Err(Error::DeadlineExpired);
    }
    let (reserve_in, reserve_out, a_to_b) = reserves_for_token_in(env, token_in)?;
    let quote = build_swap_quote(env, amount_in, reserve_in, reserve_out)?;
    if max_fee_bps.is_some_and(|limit| quote.fee_bps > limit) {
        return Err(Error::FeeLimitExceeded);
    }
    if quote.amount_out < min_out {
        return Err(Error::SlippageExceeded);
    }
    if let Some(config) = get_dynamic_fee_config(env) {
        if quote.price_impact_bps > config.max_price_impact_bps {
            return Err(Error::PriceImpactExceeded);
        }
    }

    let old_reserve_a = get_reserve_a(env);
    let old_reserve_b = get_reserve_b(env);
    let (new_reserve_a, new_reserve_b) = if a_to_b {
        (
            reserve_in.checked_add(amount_in).ok_or(Error::Overflow)?,
            reserve_out
                .checked_sub(quote.amount_out)
                .ok_or(Error::Overflow)?,
        )
    } else {
        (
            reserve_out
                .checked_sub(quote.amount_out)
                .ok_or(Error::Overflow)?,
            reserve_in.checked_add(amount_in).ok_or(Error::Overflow)?,
        )
    };
    set_reserve_a(env, new_reserve_a);
    set_reserve_b(env, new_reserve_b);
    update_twap(env, old_reserve_a, old_reserve_b);
    update_volatility(env, new_reserve_a, new_reserve_b)?;
    record_swap_metrics(env, amount_in, quote.fee_bps)?;

    env.events()
        .publish((symbol_short!("swap"),), quote.amount_out);
    if get_dynamic_fee_config(env).is_some() {
        env.events().publish(
            (symbol_short!("fee_curve"),),
            (
                quote.fee_bps,
                quote.volatility_bps,
                quote.utilization_bps,
                quote.price_impact_bps,
            ),
        );
    }
    Ok(quote.amount_out)
}

fn spot_price(reserve_a: i128, reserve_b: i128) -> Result<i128, Error> {
    if reserve_a <= 0 || reserve_b <= 0 {
        return Err(Error::InsufficientLiquidity);
    }
    reserve_b
        .checked_mul(PRICE_PRECISION)
        .and_then(|value| value.checked_div(reserve_a))
        .ok_or(Error::Overflow)
}

fn update_volatility(env: &Env, reserve_a: i128, reserve_b: i128) -> Result<(), Error> {
    let Some(config) = get_dynamic_fee_config(env) else {
        return Ok(());
    };
    let price = spot_price(reserve_a, reserve_b)?;
    let mut state = get_volatility_state(env);
    let recent_volatility = decayed_volatility(env, &config)?;
    let absolute_return = if state.last_price == 0 {
        0
    } else {
        price
            .abs_diff(state.last_price)
            .checked_mul(BPS as u128)
            .and_then(|value| value.checked_div(state.last_price as u128))
            .and_then(|value| i128::try_from(value).ok())
            .ok_or(Error::Overflow)?
            .min(BPS)
    };
    let retained = recent_volatility
        .checked_mul(BPS - config.ema_alpha_bps)
        .ok_or(Error::Overflow)?;
    let latest = absolute_return
        .checked_mul(config.ema_alpha_bps)
        .ok_or(Error::Overflow)?;
    state.ema_volatility_bps = retained
        .checked_add(latest)
        .and_then(|value| value.checked_div(BPS))
        .ok_or(Error::Overflow)?;
    state.last_price = price;
    state.last_timestamp = env.ledger().timestamp();
    set_volatility_state(env, &state);
    Ok(())
}

/// Constant-product output: amount_out = (amount_in * (10000 - fee_bps) * rb)
///                                       / (ra * 10000 + amount_in * (10000 - fee_bps))
fn constant_product_amount_out(
    amount_in: i128,
    ra: i128,
    rb: i128,
    fee_bps: i128,
) -> Result<i128, Error> {
    if ra == 0 || rb == 0 {
        return Err(Error::InsufficientLiquidity);
    }
    let fee_factor = 10_000 - fee_bps;
    let numerator = amount_in
        .checked_mul(fee_factor)
        .ok_or(Error::Overflow)?
        .checked_mul(rb)
        .ok_or(Error::Overflow)?;
    let denominator = ra
        .checked_mul(10_000)
        .ok_or(Error::Overflow)?
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
    set_price_a_cum(
        env,
        get_price_a_cum(env).saturating_add(price_a.saturating_mul(elapsed)),
    );
    set_price_b_cum(
        env,
        get_price_b_cum(env).saturating_add(price_b.saturating_mul(elapsed)),
    );
    set_last_ts(env, now);
}
