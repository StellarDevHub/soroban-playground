use soroban_sdk::Env;

use crate::oracle::PRICE_SCALE;
use crate::storage::{get_liquidation_threshold, get_min_collateral_ratio};
use crate::types::{CollateralPosition, Error};

/// Maximum collateral ratio (in basis points) that can be represented.
///
/// Used when a position's debt value truncates to zero (sub-scale debt), in
/// which case the position is effectively fully collateralized. Capping here
/// keeps downstream arithmetic (e.g. health factor) from overflowing `i128`
/// while still signalling an over-collateralized position.
pub const MAX_COLLATERAL_RATIO: i128 = i64::MAX as i128;

/// Calculate collateral ratio in basis points
/// Formula: (collateral_amount / (minted_amount * price)) * 10000
pub fn calculate_collateral_ratio(
    collateral_amount: i128,
    minted_amount: i128,
    price: i128,
) -> Result<i128, Error> {
    if minted_amount == 0 || price == 0 {
        return Err(Error::InvalidAmount);
    }

    let debt_value = minted_amount
        .checked_mul(price)
        .ok_or(Error::Overflow)?
        .checked_div(PRICE_SCALE)
        .ok_or(Error::Overflow)?;

    // A sub-scale debt value (less than 1) truncates to zero. Such a position
    // is effectively fully collateralized, so represent the ratio as the
    // maximum instead of dividing by zero (which previously panicked).
    if debt_value == 0 {
        return Ok(MAX_COLLATERAL_RATIO);
    }

    let ratio = collateral_amount
        .checked_mul(10000)
        .ok_or(Error::Overflow)?
        .checked_div(debt_value)
        .ok_or(Error::DivisionByZero)?;

    Ok(ratio.min(MAX_COLLATERAL_RATIO))
}

/// Check if position is above liquidation threshold
pub fn is_above_liquidation_threshold(
    env: &Env,
    position: &CollateralPosition,
    price: i128,
) -> Result<bool, Error> {
    let threshold = get_liquidation_threshold(env)?;
    let ratio =
        calculate_collateral_ratio(position.collateral_amount, position.minted_amount, price)?;

    Ok(ratio <= threshold as i128)
}

/// Calculate maximum mint amount given collateral
/// Formula: collateral_amount / (price * min_ratio / 10000)
pub fn calculate_max_mint_amount(
    env: &Env,
    collateral_amount: i128,
    price: i128,
) -> Result<i128, Error> {
    if price == 0 {
        return Err(Error::InvalidPrice);
    }

    let min_ratio = get_min_collateral_ratio(env)?;
    let max_mint = collateral_amount
        .checked_mul(PRICE_SCALE)
        .ok_or(Error::Overflow)?
        .checked_mul(10000)
        .ok_or(Error::Overflow)?
        .checked_div(
            price
                .checked_mul(min_ratio as i128)
                .ok_or(Error::Overflow)?,
        )
        .ok_or(Error::DivisionByZero)?;

    Ok(max_mint)
}

/// Calculate liquidation reward for liquidator
/// Formula: repay_amount * price * (1 + bonus/10000)
pub fn calculate_liquidation_reward(
    repay_amount: i128,
    price: i128,
    total_collateral: i128,
    total_minted: i128,
    bonus_bps: u32,
) -> Result<i128, Error> {
    if repay_amount <= 0 || price <= 0 {
        return Err(Error::InvalidAmount);
    }

    if total_minted == 0 {
        return Err(Error::InvalidAmount);
    }

    // Calculate proportional collateral for the repay amount
    let collateral_share = repay_amount
        .checked_mul(total_collateral)
        .ok_or(Error::Overflow)?
        .checked_div(total_minted)
        .ok_or(Error::DivisionByZero)?;

    // Apply bonus
    let bonus = collateral_share
        .checked_mul(bonus_bps as i128)
        .ok_or(Error::Overflow)?
        .checked_div(10000)
        .ok_or(Error::DivisionByZero)?;
    let mut reward = collateral_share.checked_add(bonus).ok_or(Error::Overflow)?;

    // Ensure we don't give more collateral than exists
    if reward > total_collateral {
        reward = total_collateral;
    }

    Ok(reward)
}

pub fn calculate_required_collateral(
    mint_amount: i128,
    price: i128,
    min_ratio_bps: u32,
) -> Result<i128, Error> {
    if mint_amount <= 0 || price <= 0 {
        return Err(Error::InvalidAmount);
    }

    let numerator = mint_amount
        .checked_mul(price)
        .ok_or(Error::Overflow)?
        .checked_mul(min_ratio_bps as i128)
        .ok_or(Error::Overflow)?;
    let denominator = PRICE_SCALE.checked_mul(10000).ok_or(Error::Overflow)?;

    // Round up the required collateral
    let result = numerator
        .checked_add(denominator)
        .ok_or(Error::Overflow)?
        .checked_sub(1)
        .ok_or(Error::Overflow)?
        .checked_div(denominator)
        .ok_or(Error::DivisionByZero)?;

    Ok(result)
}

/// Check if adding collateral would make position safe
pub fn is_adding_collateral_safe(
    current_collateral: i128,
    additional_collateral: i128,
    minted_amount: i128,
    price: i128,
    min_ratio_bps: u32,
) -> Result<bool, Error> {
    let new_collateral = current_collateral
        .checked_add(additional_collateral)
        .ok_or(Error::Overflow)?;
    let new_ratio = calculate_collateral_ratio(new_collateral, minted_amount, price)?;

    Ok(new_ratio >= min_ratio_bps as i128)
}

/// Calculate health factor (collateral ratio / liquidation threshold)
/// Returns value in basis points (> 10000 means healthy)
pub fn calculate_health_factor(
    collateral_amount: i128,
    minted_amount: i128,
    price: i128,
    liquidation_threshold_bps: u32,
) -> Result<i128, Error> {
    let collateral_ratio = calculate_collateral_ratio(collateral_amount, minted_amount, price)?;
    let health = collateral_ratio
        .checked_mul(10000)
        .ok_or(Error::Overflow)?
        .checked_div(liquidation_threshold_bps as i128)
        .ok_or(Error::DivisionByZero)?;

    Ok(health)
}
