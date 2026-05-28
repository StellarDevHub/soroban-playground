//! Dummy Token Contract with robust error handling
use soroban_sdk::{contractimpl, Env, Symbol, Bytes, Error};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenError {
    /// Returned when trying to mint zero amount
    ZeroMint,
    /// Returned when trying to transfer more than balance
    InsufficientBalance,
    /// Generic contract error wrapper
    ContractError(Error),
}

impl From<Error> for TokenError {
    fn from(e: Error) -> Self { TokenError::ContractError(e) }
}

pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    /// Mint `amount` tokens to `to` address.
    pub fn mint(_env: Env, _to: Bytes, amount: i128) -> Result<(), TokenError> {
        if amount <= 0 {
            return Err(TokenError::ZeroMint);
        }
        // Dummy implementation – in real contract you would credit balance
        Ok(())
    }

    /// Transfer `amount` tokens from `from` to `to`.
    pub fn transfer(_env: Env, _from: Bytes, _to: Bytes, amount: i128) -> Result<(), TokenError> {
        if amount <= 0 {
            return Err(TokenError::ZeroMint);
        }
        // Dummy check – assume insufficient balance if amount > 1_000_000
        if amount > 1_000_000 {
            return Err(TokenError::InsufficientBalance);
        }
        Ok(())
    }
}
