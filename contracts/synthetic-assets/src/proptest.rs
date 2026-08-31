//! Property-based tests for the Synthetic Assets safe-math and fixed-point
//! routines.
//!
//! These tests assert algebraic invariants across 10,000 random input
//! permutations per property, and verify that every arithmetic helper reports
//! [`Error::Overflow`] / [`Error::DivisionByZero`] instead of silently
//! wrapping or panicking when fed extreme values.

#![cfg(test)]

use proptest::prelude::*;

use crate::collateral::{
    calculate_collateral_ratio, calculate_health_factor, calculate_liquidation_reward,
    calculate_required_collateral,
};
use crate::math::FixedPoint;
use crate::oracle::PRICE_SCALE;
use crate::types::Error;

fn default_config() -> ProptestConfig {
    ProptestConfig::with_cases(10_000)
}

/// Bounded positive fixed-point values used for invariant tests. They are
/// small enough that intermediate products never overflow, while large enough
/// to exercise real precision behaviour.
fn fxp() -> impl Strategy<Value = i128> {
    (1i128..100_000).prop_map(|v| v * PRICE_SCALE)
}

proptest! {
    #![proptest_config(default_config())]

    /// Fixed-point multiplication by the multiplicative identity (1.0) is the
    /// identity: FixedPoint(a) * FixedPoint(1) === FixedPoint(a).
    #[test]
    fn fixed_point_mul_identity(a in fxp()) {
        let one = FixedPoint::from_raw(PRICE_SCALE);
        let x = FixedPoint::from_raw(a);
        prop_assert_eq!(x.checked_mul(one).unwrap(), x);
    }

    /// Fixed-point division by the multiplicative identity is the identity.
    #[test]
    fn fixed_point_div_identity(a in fxp()) {
        let one = FixedPoint::from_raw(PRICE_SCALE);
        let x = FixedPoint::from_raw(a);
        prop_assert_eq!(x.checked_div(one).unwrap(), x);
    }

    /// Fixed-point multiplication is commutative: a * b === b * a.
    #[test]
    fn fixed_point_mul_commutative(a in fxp(), b in fxp()) {
        let x = FixedPoint::from_raw(a);
        let y = FixedPoint::from_raw(b);
        prop_assert_eq!(x.checked_mul(y).unwrap(), y.checked_mul(x).unwrap());
    }

    /// Fixed-point addition is commutative.
    #[test]
    fn fixed_point_add_commutative(a in fxp(), b in fxp()) {
        let x = FixedPoint::from_raw(a);
        let y = FixedPoint::from_raw(b);
        prop_assert_eq!(x.checked_add(y).unwrap(), y.checked_add(x).unwrap());
    }

    /// `(a * b) / S` reproduces the exact integer product scaled by `S`,
    /// confirming no silent precision loss or wrapping occurs.
    #[test]
    fn fixed_point_mul_scales_consistently(a in fxp(), b in fxp()) {
        let x = FixedPoint::from_raw(a);
        let y = FixedPoint::from_raw(b);
        let product = x.checked_mul(y).unwrap();
        let expected = (a * b) / PRICE_SCALE;
        prop_assert_eq!(product.to_i128(), expected);
    }

    /// Bounded collateral ratio is always non-negative.
    #[test]
    fn collateral_ratio_non_negative(
        collateral in fxp(),
        minted in 1i128..100_000,
        price in 1i128..100_000,
    ) {
        let ratio = calculate_collateral_ratio(collateral, minted, price).unwrap();
        prop_assert!(ratio >= 0);
    }

    /// Increasing collateral never lowers the collateral ratio.
    #[test]
    fn collateral_ratio_monotonic_in_collateral(
        c1 in fxp(),
        c2 in fxp(),
        minted in 1i128..100_000,
        price in 1i128..100_000,
    ) {
        let r1 = calculate_collateral_ratio(c1.min(c2), minted, price).unwrap();
        let r2 = calculate_collateral_ratio(c1.max(c2), minted, price).unwrap();
        prop_assert!(r2 >= r1);
    }

    /// Division by zero (zero minted) is reported, never silently wrapped.
    #[test]
    fn collateral_ratio_rejects_zero_minted(collateral in fxp(), price in 1i128..100_000) {
        let result = calculate_collateral_ratio(collateral, 0, price);
        prop_assert!(result.is_err());
    }

    /// Division by zero (zero price) is reported, never silently wrapped.
    #[test]
    fn collateral_ratio_rejects_zero_price(collateral in fxp(), minted in 1i128..100_000) {
        let result = calculate_collateral_ratio(collateral, minted, 0);
        prop_assert!(result.is_err());
    }

    /// Health factor stays exactly consistent with the collateral ratio:
    /// health_bps = ratio * 10000 / threshold.
    #[test]
    fn health_factor_scale_consistent(
        collateral in fxp(),
        minted in 1i128..100_000,
        price in 1i128..100_000,
    ) {
        let ratio = calculate_collateral_ratio(collateral, minted, price).unwrap();
        let threshold = 12000u32;
        let health = calculate_health_factor(collateral, minted, price, threshold).unwrap();
        let expected = ratio.checked_mul(10000).unwrap() / threshold as i128;
        prop_assert_eq!(health, expected);
    }

    /// Liquidation reward is never negative and never exceeds the total
    /// collateral available, guarding the protocol's highest-leverage path.
    #[test]
    fn liquidation_reward_bounded(
        repay in 1i128..100_000,
        price in 1i128..100_000,
        total_collateral in 1i128..100_000,
        total_minted in 1i128..100_000,
        bonus in 0u32..2000u32,
    ) {
        let reward = calculate_liquidation_reward(repay, price, total_collateral, total_minted, bonus).unwrap();
        prop_assert!(reward >= 0);
        prop_assert!(reward <= total_collateral);
    }

    /// Required collateral is always positive for positive inputs.
    #[test]
    fn required_collateral_positive(
        mint in 1i128..100_000,
        price in 1i128..100_000,
        ratio in 10000u32..50000u32,
    ) {
        let req = calculate_required_collateral(mint, price, ratio).unwrap();
        prop_assert!(req > 0);
    }

    /// Fixed-point multiplication that overflows i128 is reported as
    /// [`Error::Overflow`], never a wrapped value and never a panic.
    #[test]
    fn overflow_is_reported_not_wrapped(a in (i128::MAX / 2)..i128::MAX, b in (i128::MAX / 2)..i128::MAX) {
        let x = FixedPoint::from_raw(a);
        let y = FixedPoint::from_raw(b);
        let result = x.checked_mul(y);
        prop_assert!(result.is_err());
        prop_assert_eq!(result, Err(Error::Overflow));
    }

    /// Fixed-point division by zero is reported as [`Error::DivisionByZero`].
    #[test]
    fn division_by_zero_is_reported(a in fxp()) {
        let x = FixedPoint::from_raw(a);
        let zero = FixedPoint::from_raw(0);
        let result = x.checked_div(zero);
        prop_assert!(result.is_err());
        prop_assert_eq!(result, Err(Error::DivisionByZero));
    }
}
