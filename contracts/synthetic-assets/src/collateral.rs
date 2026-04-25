use soroban_sdk::Env;

use crate::oracle::PRICE_SCALE;
use crate::storage::{get_liquidation_threshold, get_min_collateral_ratio};
use crate::types::{CollateralPosition, Error};

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

    let debt_value = (minted_amount * price) / PRICE_SCALE;
    let ratio = (collateral_amount * 10000) / debt_value;

    Ok(ratio)
}

/// Check if position is above liquidation threshold
pub fn is_above_liquidation_threshold(
    env: &Env,
    position: &CollateralPosition,
    price: i128,
) -> Result<bool, Error> {
    let threshold = get_liquidation_threshold(env)?;
    let ratio = calculate_collateral_ratio(
        position.collateral_amount,
        position.minted_amount,
        price,
    )?;

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
    let max_mint = (collateral_amount * PRICE_SCALE * 10000) / (price * min_ratio as i128);

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
    let collateral_share = (repay_amount * total_collateral) / total_minted;

    // Apply bonus
    let bonus = (collateral_share * bonus_bps as i128) / 10000;
    let reward = collateral_share + bonus;

    // Ensure we don't give more collateral than exists
    if reward > total_collateral {
        return Err(Error::InsufficientBalance);
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

    let numerator = mint_amount * price * min_ratio_bps as i128;
    let denominator = PRICE_SCALE * 10000;

    Ok((numerator + denominator - 1) / denominator)
}

/// Check if adding collateral would make position safe
pub fn is_adding_collateral_safe(
    current_collateral: i128,
    additional_collateral: i128,
    minted_amount: i128,
    price: i128,
    min_ratio_bps: u32,
) -> Result<bool, Error> {
    let new_collateral = current_collateral + additional_collateral;
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
    let health = (collateral_ratio * 10000) / liquidation_threshold_bps as i128;

    Ok(health)
}
