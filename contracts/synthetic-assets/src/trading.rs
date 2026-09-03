use soroban_sdk::Env;

use crate::storage::get_fee_percentage;
use crate::types::{Error, TradeDirection, TradingPosition};

const MIN_TRADE_MARGIN: i128 = 250_000;

/// Calculate trading PnL (Profit and Loss)
/// Long: (current_price - entry_price) * notional / entry_price
/// Short: (entry_price - current_price) * notional / entry_price
pub fn calculate_pnl(position: &TradingPosition, current_price: i128) -> Result<i128, Error> {
    if position.entry_price <= 0 || current_price <= 0 {
        return Err(Error::InvalidPrice);
    }

    let price_diff = match position.direction {
        TradeDirection::Long => current_price
            .checked_sub(position.entry_price)
            .ok_or(Error::Overflow)?,
        TradeDirection::Short => position
            .entry_price
            .checked_sub(current_price)
            .ok_or(Error::Overflow)?,
    };

    Ok(price_diff
        .checked_mul(position.notional)
        .ok_or(Error::Overflow)?
        .checked_div(position.entry_price)
        .ok_or(Error::DivisionByZero)?)
}

/// Calculate required margin for a trade
pub fn calculate_margin_requirement(_env: &Env, notional: i128) -> Result<i128, Error> {
    if notional <= 0 {
        return Err(Error::InvalidAmount);
    }

    // Minimum margin is based on maximum leverage (10x = 10% margin)
    let min_margin_ratio: i128 = 1000; // 10% minimum margin

    let min_margin = notional
        .checked_mul(min_margin_ratio)
        .ok_or(Error::Overflow)?
        .checked_div(10000)
        .ok_or(Error::DivisionByZero)?
        .max(MIN_TRADE_MARGIN);
    Ok(min_margin)
}

/// Check if trade is safe (not over-leveraged)
pub fn is_trade_safe(
    _env: &Env,
    position: &TradingPosition,
    current_price: i128,
) -> Result<bool, Error> {
    let liquidation_price = calculate_liquidation_price(position)?;

    let is_safe = match position.direction {
        TradeDirection::Long => current_price > liquidation_price,
        TradeDirection::Short => current_price < liquidation_price,
    };

    Ok(is_safe)
}

/// Calculate liquidation price for a trading position
/// Long: entry_price * (1 - margin / notional)
/// Short: entry_price * (1 + margin / notional)
pub fn calculate_liquidation_price(position: &TradingPosition) -> Result<i128, Error> {
    if position.notional == 0 {
        return Err(Error::InvalidAmount);
    }

    let margin_ratio = position
        .margin
        .checked_mul(10000)
        .ok_or(Error::Overflow)?
        .checked_div(position.notional)
        .ok_or(Error::DivisionByZero)?;

    let margin_impact = position
        .entry_price
        .checked_mul(margin_ratio)
        .ok_or(Error::Overflow)?
        .checked_div(10000)
        .ok_or(Error::DivisionByZero)?;

    let liquidation_price = match position.direction {
        TradeDirection::Long => position.entry_price.checked_sub(margin_impact),
        TradeDirection::Short => position.entry_price.checked_add(margin_impact),
    }
    .ok_or(Error::Overflow)?;

    Ok(liquidation_price)
}

/// Calculate unrealized PnL percentage (basis points)
pub fn calculate_pnl_percentage(
    position: &TradingPosition,
    current_price: i128,
) -> Result<i128, Error> {
    let pnl = calculate_pnl(position, current_price)?;
    if position.margin == 0 {
        return Err(Error::InvalidAmount);
    }
    Ok(pnl
        .checked_mul(10000)
        .ok_or(Error::Overflow)?
        .checked_div(position.margin)
        .ok_or(Error::DivisionByZero)?)
}

/// Calculate trading fee (basis points)
pub fn calculate_trading_fee(env: &Env, notional: i128) -> Result<i128, Error> {
    let fee_percentage = get_fee_percentage(env)?;
    Ok(notional
        .checked_mul(fee_percentage as i128)
        .ok_or(Error::Overflow)?
        .checked_div(10000)
        .ok_or(Error::DivisionByZero)?)
}

/// Calculate effective notional after fees
pub fn calculate_effective_notional(env: &Env, margin: i128, leverage: u32) -> Result<i128, Error> {
    let gross_notional = margin
        .checked_mul(leverage as i128)
        .ok_or(Error::Overflow)?
        .checked_div(10000)
        .ok_or(Error::DivisionByZero)?;
    let fee = calculate_trading_fee(env, gross_notional)?;
    Ok(gross_notional.checked_sub(fee).ok_or(Error::Overflow)?)
}

/// Suggest conservative leverage based on volatility (bps)
pub fn calculate_safe_leverage(volatility: u32) -> u32 {
    let vol_component = volatility
        .checked_div(100)
        .and_then(|v| v.checked_add(10000))
        .unwrap_or(u32::MAX);
    if vol_component == 0 {
        return 10000;
    }
    (10000000_u32.checked_div(vol_component).unwrap_or(0))
        .min(100000)
        .max(10000)
}

/// Should the trading position be liquidated?
pub fn should_liquidate_trading_position(
    position: &TradingPosition,
    current_price: i128,
) -> Result<bool, Error> {
    let pnl = calculate_pnl(position, current_price)?;
    let combined = position.margin.checked_add(pnl).ok_or(Error::Overflow)?;
    Ok(combined <= 0)
}
