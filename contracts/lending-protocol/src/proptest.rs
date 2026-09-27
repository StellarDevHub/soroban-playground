//! Property-based invariant tests for the lending protocol's collateral,
//! liquidation, and utilization math (Issue #1565).
//!
//! These three functions decide whether a borrow is allowed, how much a
//! liquidator seizes, and what the pool reports as utilized. A rounding or
//! ordering mistake in any of them is a solvency mistake, and the failing
//! inputs are the extreme ones example tests rarely reach.
//!
//! Each property runs 10,000 permutations.

#![cfg(test)]

use proptest::prelude::*;

use crate::types::Error;
use crate::{
    calculate_liquidation_seizure, calculate_utilization_rate, check_collateral_ratio,
    COLLATERAL_RATIO_DEN, COLLATERAL_RATIO_NUM, LIQUIDATION_BONUS_DEN, LIQUIDATION_BONUS_NUM,
};

/// Ceiling division for non-negative values.
///
/// `i128::div_ceil` is still unstable on this toolchain, and the collateral
/// requirement is a ceiling — see `exact_ratio_is_accepted`.
fn ceil_div(numerator: i128, denominator: i128) -> i128 {
    (numerator + denominator - 1) / denominator
}

fn default_config() -> ProptestConfig {
    ProptestConfig::with_cases(10_000)
}

/// Amounts large enough to be realistic but small enough that the contract's
/// own `checked_mul` by a ratio numerator cannot overflow — an overflow here
/// would be the test's fault, not the contract's.
fn amount() -> impl Strategy<Value = i128> {
    0i128..1_000_000_000_000_000i128
}

fn positive_amount() -> impl Strategy<Value = i128> {
    1i128..1_000_000_000_000_000i128
}

proptest! {
    #![proptest_config(default_config())]

    /// A position with nothing borrowed is always healthy, whatever the
    /// collateral — including none. Requiring collateral against a zero debt
    /// would block a first deposit.
    #[test]
    fn zero_debt_is_always_healthy(deposited in amount()) {
        prop_assert!(check_collateral_ratio(deposited, 0).is_ok());
    }

    /// Borrowing against no collateral is always refused.
    #[test]
    fn no_collateral_cannot_borrow(borrowed in positive_amount()) {
        prop_assert_eq!(
            check_collateral_ratio(0, borrowed),
            Err(Error::InsufficientCollateral)
        );
    }

    /// Exactly the required ratio is accepted.
    ///
    /// The requirement is a *ceiling*: the contract compares
    /// `borrowed * NUM > deposited * DEN`, so flooring the division leaves a
    /// position one unit short whenever `borrowed * NUM` is not divisible by
    /// `DEN`. This property caught exactly that mistake in its first draft,
    /// which is the boundary most likely to flip under a refactor between
    /// `>` and `>=`.
    #[test]
    fn exact_ratio_is_accepted(borrowed in 1i128..1_000_000_000i128) {
        let required = ceil_div(borrowed * COLLATERAL_RATIO_NUM, COLLATERAL_RATIO_DEN);
        prop_assert!(check_collateral_ratio(required, borrowed).is_ok());
    }

    /// One unit below the requirement is refused.
    ///
    /// Paired with the property above, this pins the boundary from both
    /// sides: together they say the threshold sits exactly at the ceiling and
    /// nowhere else.
    #[test]
    fn one_below_requirement_is_refused(borrowed in 1i128..1_000_000_000i128) {
        let required = ceil_div(borrowed * COLLATERAL_RATIO_NUM, COLLATERAL_RATIO_DEN);
        prop_assume!(required > 0);
        prop_assert_eq!(
            check_collateral_ratio(required - 1, borrowed),
            Err(Error::InsufficientCollateral)
        );
    }

    /// Collateral above the requirement is always accepted.
    #[test]
    fn surplus_collateral_is_accepted(
        borrowed in 1i128..1_000_000_000i128,
        surplus in 0i128..1_000_000_000i128,
    ) {
        let required = ceil_div(borrowed * COLLATERAL_RATIO_NUM, COLLATERAL_RATIO_DEN);
        prop_assert!(check_collateral_ratio(required + surplus, borrowed).is_ok());
    }

    /// Collateral below the requirement is always refused.
    #[test]
    fn deficient_collateral_is_refused(
        borrowed in 1_000i128..1_000_000_000i128,
        shortfall in 1i128..1_000i128,
    ) {
        let required = ceil_div(borrowed * COLLATERAL_RATIO_NUM, COLLATERAL_RATIO_DEN);
        prop_assert_eq!(
            check_collateral_ratio(required - shortfall, borrowed),
            Err(Error::InsufficientCollateral)
        );
    }

    /// Health is monotonic in collateral: adding collateral never turns an
    /// accepted position into a rejected one.
    #[test]
    fn more_collateral_never_hurts(
        deposited in positive_amount(),
        added in 0i128..1_000_000_000i128,
        borrowed in 0i128..1_000_000_000i128,
    ) {
        if check_collateral_ratio(deposited, borrowed).is_ok() {
            prop_assert!(check_collateral_ratio(deposited + added, borrowed).is_ok());
        }
    }

    /// Health is monotonic in debt: borrowing more never turns a rejected
    /// position into an accepted one.
    #[test]
    fn more_debt_never_helps(
        deposited in positive_amount(),
        borrowed in 1i128..1_000_000_000i128,
        extra in 1i128..1_000_000_000i128,
    ) {
        if check_collateral_ratio(deposited, borrowed).is_err() {
            prop_assert!(check_collateral_ratio(deposited, borrowed + extra).is_err());
        }
    }

    /// A liquidator always seizes at least the debt they repaid.
    ///
    /// Seizing less than the repayment makes liquidation unprofitable, and an
    /// unprofitable liquidation is one nobody performs — which is how a
    /// protocol ends up holding bad debt.
    #[test]
    fn seizure_covers_the_repayment(amount in 0i128..1_000_000_000_000i128) {
        let seized = calculate_liquidation_seizure(amount).unwrap();
        prop_assert!(seized >= amount, "seized {seized} < repaid {amount}");
    }

    /// The seizure bonus never exceeds the configured rate.
    ///
    /// Over-seizing is theft from the borrower, so the upper bound matters as
    /// much as the lower one.
    #[test]
    fn seizure_respects_the_bonus_cap(amount in 0i128..1_000_000_000_000i128) {
        let seized = calculate_liquidation_seizure(amount).unwrap();
        let cap = amount * LIQUIDATION_BONUS_NUM / LIQUIDATION_BONUS_DEN;
        prop_assert!(seized <= cap, "seized {seized} above cap {cap}");
    }

    /// Seizure is monotonic in the repaid amount.
    #[test]
    fn seizure_is_monotonic(
        amount in 0i128..1_000_000_000i128,
        delta in 0i128..1_000_000_000i128,
    ) {
        let a = calculate_liquidation_seizure(amount).unwrap();
        let b = calculate_liquidation_seizure(amount + delta).unwrap();
        prop_assert!(b >= a);
    }

    /// Utilization is zero for an empty pool rather than a division panic.
    #[test]
    fn utilization_zero_for_empty_pool(borrowed in amount()) {
        prop_assert_eq!(calculate_utilization_rate(0, borrowed), 0);
        prop_assert_eq!(calculate_utilization_rate(-1, borrowed), 0);
    }

    /// Utilization never goes negative for a pool with non-negative figures.
    #[test]
    fn utilization_never_negative(
        deposited in 1i128..1_000_000_000_000i128,
        borrowed in 0i128..1_000_000_000_000i128,
    ) {
        prop_assert!(calculate_utilization_rate(deposited, borrowed) >= 0);
    }

    /// A fully drawn pool reports exactly 100%, in basis points.
    #[test]
    fn full_utilization_is_ten_thousand_bps(deposited in 1i128..1_000_000_000_000i128) {
        prop_assert_eq!(calculate_utilization_rate(deposited, deposited), 10_000);
    }

    /// Utilization rises with borrowing against a fixed deposit base.
    #[test]
    fn utilization_is_monotonic_in_borrowing(
        deposited in 1_000i128..1_000_000_000i128,
        borrowed in 0i128..1_000_000_000i128,
        extra in 0i128..1_000_000_000i128,
    ) {
        let a = calculate_utilization_rate(deposited, borrowed);
        let b = calculate_utilization_rate(deposited, borrowed + extra);
        prop_assert!(b >= a);
    }
}
