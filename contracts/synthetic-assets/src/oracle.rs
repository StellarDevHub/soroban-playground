use soroban_sdk::Env;

use crate::storage::{get_price, set_price};
use crate::types::{Error, PriceData};
use soroban_sdk::Symbol;

pub const PRICE_SCALE: i128 = 100_000_000;

/// Maximum age of a price before it's considered stale (in seconds)
const MAX_PRICE_AGE: u64 = 300; // 5 minutes

/// Minimum confidence level for valid price (0-100)
const MIN_CONFIDENCE: u32 = 50;

/// Update price with validation
pub fn update_price_internal(
    env: &Env,
    asset_symbol: &Symbol,
    new_price: i128,
    confidence: u32,
) -> Result<(), Error> {
    validate_price(new_price, confidence)?;

    let price_data = PriceData {
        price: new_price,
        timestamp: env.ledger().timestamp(),
        confidence,
    };

    set_price(env, asset_symbol, &price_data);
    Ok(())
}

/// Get validated price
pub fn get_price_internal(env: &Env, asset_symbol: &Symbol) -> Result<i128, Error> {
    let price_data = get_price(env, asset_symbol)?;
    
    // Check if price is stale
    let current_time = env.ledger().timestamp();
    if current_time > price_data.timestamp + MAX_PRICE_AGE {
        return Err(Error::StalePrice);
    }

    // Check confidence
    if price_data.confidence < MIN_CONFIDENCE {
        return Err(Error::StalePrice);
    }

    Ok(price_data.price)
}

/// Validate price data
pub fn validate_price(price: i128, confidence: u32) -> Result<(), Error> {
    if price <= 0 {
        return Err(Error::InvalidPrice);
    }

    if confidence > 100 {
        return Err(Error::InvalidPrice);
    }

    if confidence < MIN_CONFIDENCE {
        return Err(Error::InvalidPrice);
    }

    Ok(())
}

/// Calculate price deviation between two prices (in basis points)
pub fn calculate_price_deviation(old_price: i128, new_price: i128) -> u32 {
    if old_price == 0 {
        return 0;
    }
    
    let diff = if new_price > old_price {
        new_price - old_price
    } else {
        old_price - new_price
    };

    ((diff * 10000) / old_price) as u32
}

/// Check if price deviation is within acceptable bounds
pub fn is_price_valid_deviation(old_price: i128, new_price: i128, max_deviation: u32) -> bool {
    calculate_price_deviation(old_price, new_price) <= max_deviation
}
