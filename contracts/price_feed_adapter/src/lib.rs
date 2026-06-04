//! Dummy Price Feed Adapter contract with robust error handling
use soroban_sdk::{contractimpl, Env, Symbol, Bytes, Error};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PriceFeedError {
    /// Returned when the requested symbol is not supported
    UnsupportedSymbol,
    /// Returned when the price data is unavailable
    DataUnavailable,
    /// Generic contract error wrapper
    ContractError(Error),
}

impl From<Error> for PriceFeedError {
    fn from(e: Error) -> Self { PriceFeedError::ContractError(e) }
}

pub struct PriceFeedAdapter;

#[contractimpl]
impl PriceFeedAdapter {
    /// Returns a dummy price for `symbol`.
    /// Errors if the symbol is empty or unsupported.
    pub fn get_price(env: Env, symbol: Bytes) -> Result<i128, PriceFeedError> {
        if symbol.is_empty() {
            return Err(PriceFeedError::UnsupportedSymbol);
        }
        // Dummy fixed price for illustration purposes
        let price: i128 = 1_000_000; // e.g., price with 6 decimals
        Ok(price)
    }
}
