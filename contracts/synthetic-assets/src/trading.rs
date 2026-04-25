use soroban_sdk::Env;

use crate::storage::get_fee_percentage;
use crate::types::{Error, TradeDirection, TradingPosition};

const MIN_TRADE_MARGIN: i128 = 250_000;

/// Calculate trading PnL
/// For Long: (current_price - entry_price) * notional / entry_price
/// For Short: (entry_price - current_price) * notional / entry_price
pub fn calculate_pnl(
    position: &TradingPosition,
    current_price: i128,
) -> Result<i128, Error> {
    if position.entry_price == 0 || current_price <= 0 {
        return Err(Error::InvalidPrice);
    }

    let pnl = match position.direction {
        TradeDirection::Long => {
            // Long: profit when price goes up
            let price_diff = current_price - position.entry_price;
            (price_diff * position.notional) / position.entry_price
        }
        TradeDirection::Short => {
            // Short: profit when price goes down
            let price_diff = position.entry_price - current_price;
            (price_diff * position.notional) / position.entry_price
        }
    };

    Ok(pnl)
}

/// Calculate required margin for a trade
pub fn calculate_margin_requirement(
    _env: &Env,
    notional: i128,
) -> Result<i128, Error> {
    if notional <= 0 {
        return Err(Error::InvalidAmount);
    }

    // Minimum margin is based on maximum leverage
    // Using inverse of 10x leverage (100000 bps) as minimum, with
    // an absolute floor to avoid dust-sized leveraged positions.
    let min_margin_ratio: i128 = 1000; // 10% minimum margin (10x max leverage)

    Ok(((notional * min_margin_ratio) / 10000).max(MIN_TRADE_MARGIN))
}

/// Check if trade is safe (not over-leveraged)
pub fn is_trade_safe(
    _env: &Env,
    position: &TradingPosition,
    current_price: i128,
) -> Result<bool, Error> {
    // Calculate liquidation price based on direction
    let liquidation_price = calculate_liquidation_price(position)?;

    let is_safe = match position.direction {
        TradeDirection::Long => {
            // Long position liquidates when price drops below liquidation price
            current_price > liquidation_price
        }
        TradeDirection::Short => {
            // Short position liquidates when price rises above liquidation price
            current_price < liquidation_price
        }
    };

    Ok(is_safe)
}

/// Calculate liquidation price for a trading position
/// Formula depends on direction:
/// Long: entry_price * (1 - margin / notional)
/// Short: entry_price * (1 + margin / notional)
pub fn calculate_liquidation_price(position: &TradingPosition) -> Result<i128, Error> {
    if position.notional == 0 {
        return Err(Error::InvalidAmount);
    }

    let margin_ratio = (position.margin * 10000) / position.notional;

    let liquidation_price = match position.direction {
        TradeDirection::Long => {
            // Price can drop by margin_ratio before liquidation
            let max_drop = (position.entry_price * margin_ratio) / 10000;
            position.entry_price - max_drop
        }
        TradeDirection::Short => {
            // Price can rise by margin_ratio before liquidation
            let max_rise = (position.entry_price * margin_ratio) / 10000;
            position.entry_price + max_rise
        }
    };

    Ok(liquidation_price)
}

/// Calculate unrealized PnL percentage
pub fn calculate_pnl_percentage(
    position: &TradingPosition,
    current_price: i128,
) -> Result<i128, Error> {
    let pnl = calculate_pnl(position, current_price)?;
    
    if position.margin == 0 {
        return Err(Error::InvalidAmount);
    }

    let pnl_percentage = (pnl * 10000) / position.margin;
    Ok(pnl_percentage)
}

/// Calculate trading fee
pub fn calculate_trading_fee(
    env: &Env,
    notional: i128,
) -> Result<i128, Error> {
    let fee_percentage = get_fee_percentage(env)?;
    let fee = (notional * fee_percentage as i128) / 10000;
    Ok(fee)
}

/// Calculate effective notional after fees
pub fn calculate_effective_notional(
    env: &Env,
    margin: i128,
    leverage: u32,
) -> Result<i128, Error> {
    let gross_notional = (margin * leverage as i128) / 10000;
    let fee = calculate_trading_fee(env, gross_notional)?;
    let effective_notional = gross_notional - fee;
    
    Ok(effective_notional)
}

/// Calculate available leverage based on margin
/// Conservative: 1x to 10x based on volatility
pub fn calculate_safe_leverage(
    volatility: u32, // Annualized volatility in basis points
) -> u32 {
    // Lower volatility = higher allowed leverage
    // Conservative formula: max_leverage = 100000 / (volatility / 100 + 10000)
    // This gives roughly 1x to 10x range
    
    let vol_component = volatility / 100 + 10000;
    let leverage = (10000000 / vol_component).min(100000).max(10000);
    
    leverage
}

/// Check if position should be liquidated (trading)
pub fn should_liquidate_trading_position(
    position: &TradingPosition,
    current_price: i128,
) -> Result<bool, Error> {
    let pnl = calculate_pnl(position, current_price)?;
    
    // Liquidation occurs when losses exceed margin
    // i.e., margin + pnl <= 0
    let remaining_margin = position.margin + pnl;
    
    Ok(remaining_margin <= 0)
}
