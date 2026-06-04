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
        TradeDirection::Long => current_price - position.entry_price,
        TradeDirection::Short => position.entry_price - current_price,
    };

    Ok((price_diff * position.notional) / position.entry_price)
}

/// Calculate required margin for a trade
pub fn calculate_margin_requirement(_env: &Env, notional: i128) -> Result<i128, Error> {
    if notional <= 0 {
        return Err(Error::InvalidAmount);
    }

    // Minimum margin is based on maximum leverage (10x = 10% margin)
    let min_margin_ratio: i128 = 1000; // 10% minimum margin

    Ok(((notional * min_margin_ratio) / 10000).max(MIN_TRADE_MARGIN))
}

/// Check if trade is safe (not over-leveraged)
pub fn is_trade_safe(_env: &Env, position: &TradingPosition, current_price: i128) -> Result<bool, Error> {
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

    let margin_ratio = (position.margin * 10000) / position.notional;

    let liquidation_price = match position.direction {
        TradeDirection::Long => position.entry_price - (position.entry_price * margin_ratio) / 10000,
        TradeDirection::Short => position.entry_price + (position.entry_price * margin_ratio) / 10000,
    };

    Ok(liquidation_price)
}

/// Calculate unrealized PnL percentage (basis points)
pub fn calculate_pnl_percentage(position: &TradingPosition, current_price: i128) -> Result<i128, Error> {
    let pnl = calculate_pnl(position, current_price)?;
    if position.margin == 0 {
        return Err(Error::InvalidAmount);
    }
    Ok((pnl * 10000) / position.margin)
}

/// Calculate trading fee (basis points)
pub fn calculate_trading_fee(env: &Env, notional: i128) -> Result<i128, Error> {
    let fee_percentage = get_fee_percentage(env)?;
    Ok((notional * fee_percentage as i128) / 10000)
}

/// Calculate effective notional after fees
pub fn calculate_effective_notional(env: &Env, margin: i128, leverage: u32) -> Result<i128, Error> {
    let gross_notional = (margin * leverage as i128) / 10000;
    let fee = calculate_trading_fee(env, gross_notional)?;
    Ok(gross_notional - fee)
}

/// Suggest conservative leverage based on volatility (bps)
pub fn calculate_safe_leverage(volatility: u32) -> u32 {
    let vol_component = volatility / 100 + 10000;
    (10000000 / vol_component).min(100000).max(10000)
}

/// Should the trading position be liquidated?
pub fn should_liquidate_trading_position(position: &TradingPosition, current_price: i128) -> Result<bool, Error> {
    let pnl = calculate_pnl(position, current_price)?;
    Ok(position.margin + pnl <= 0)
}
