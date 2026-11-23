/// An invariant violation found while checking token conservation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConservationError {
    NegativeSupply,
    NegativeBalance,
    ArithmeticOverflow,
    SupplyMismatch { expected: i128, actual: i128 },
}

/// Checks that user and pool balances account for the complete token supply.
///
/// The function rejects negative values and checked-add overflow instead of
/// allowing either to make an invalid state appear conserved.
pub fn check_token_conservation(
    total_supply: i128,
    user_balances: &[i128],
    pool_balances: &[i128],
) -> Result<(), ConservationError> {
    if total_supply < 0 {
        return Err(ConservationError::NegativeSupply);
    }

    let accounted = user_balances
        .iter()
        .chain(pool_balances)
        .try_fold(0i128, |sum, balance| {
            if *balance < 0 {
                return Err(ConservationError::NegativeBalance);
            }
            sum.checked_add(*balance)
                .ok_or(ConservationError::ArithmeticOverflow)
        })?;

    if accounted == total_supply {
        Ok(())
    } else {
        Err(ConservationError::SupplyMismatch {
            expected: total_supply,
            actual: accounted,
        })
    }
}
