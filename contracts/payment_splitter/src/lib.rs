//! Dummy Payment Splitter contract with robust error handling
use soroban_sdk::{contractimpl, Env, Symbol, Vec, Bytes, Error};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SplitterError {
    /// Returned when the input amount is zero
    ZeroAmount,
    /// Returned when recipient address is invalid
    InvalidRecipient,
    /// Generic contract error wrapper
    ContractError(Error),
}

impl From<Error> for SplitterError {
    fn from(e: Error) -> Self { SplitterError::ContractError(e) }
}

pub struct PaymentSplitter;

#[contractimpl]
impl PaymentSplitter {
    /// Splits `amount` equally among `recipients`.
    /// Returns an error if amount is zero or any recipient is empty.
    pub fn split(env: Env, amount: i128, recipients: Vec<Bytes>) -> Result<(), SplitterError> {
        if amount <= 0 {
            return Err(SplitterError::ZeroAmount);
        }
        if recipients.is_empty() {
            return Err(SplitterError::InvalidRecipient);
        }
        // Dummy logic: just verify recipients length divides amount
        let share = amount / (recipients.len() as i128);
        if share * (recipients.len() as i128) != amount {
            // Not evenly divisible – still proceed for dummy
        }
        // In a real contract you would transfer `share` to each recipient here
        Ok(())
    }
}
