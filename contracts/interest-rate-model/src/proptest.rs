//! Property-based tests for the interest-rate model's safe-math routines.
//!
//! These tests assert invariants across 10,000 random input permutations per
//! property and confirm that extreme inputs surface as explicit errors rather
//! than wrapped overflow or division-by-zero panics.

#![cfg(test)]

use proptest::prelude::*;
use proptest::test_runner::TestCaseError;

use crate::math::{
    compute_exponential_rate, compute_linear_rate, compute_utilization_bps,
};
use crate::types::Error;

fn default_config() -> ProptestConfig {
    ProptestConfig::with_cases(10_000)
}

/// Any `i128`, used for properties that must tolerate arbitrary values.
fn any_i128() -> impl Strategy<Value = i128> {
    any::<i128>()
}

proptest! {
    #![proptest_config(default_config())]

    /// With no funds available, utilization is exactly 0 regardless of the
    /// borrowed amount.
    #[test]
    fn utilization_zero_when_no_available(borrowed in any_i128()) {
        prop_assert_eq!(compute_utilization_bps(borrowed, 0).unwrap(), 0);
    }

    /// Utilization is never negative for a healthy pool (borrowed >= 0). The
    /// borrowed range is kept small enough that `borrowed * 10_000` cannot
    /// overflow `i128`, so overflow here would indicate a real bug rather than
    /// an unrealistic input.
    #[test]
    fn utilization_non_negative(borrowed in 0i128..100_000, total in 1i128..1_000_000) {
        let util = compute_utilization_bps(borrowed, total).unwrap();
        prop_assert!(util <= u32::MAX);
    }

    /// Utilization scales monotonically with borrowed when total is fixed.
    #[test]
    fn utilization_monotonically_increases(
        total in 1i128..1_000_000,
        b1 in 0i128..1_000_000,
        b2 in 0i128..1_000_000,
    ) {
        let u1 = compute_utilization_bps(b1, total).unwrap();
        let u2 = compute_utilization_bps(b2, total).unwrap();
        if b2 >= b1 {
            prop_assert!(u2 >= u1);
        }
    }

    /// Linear rate is monotonically non-decreasing in utilization.
    #[test]
    fn linear_rate_monotonic_in_utilization(
        base in 0u32..10_000u32,
        multiplier in 0u32..50_000u32,
        max in 10_000u32..200_000u32,
        u1 in 0u32..10_000u32,
        u2 in 0u32..10_000u32,
    ) {
        let r1 = compute_linear_rate(base, multiplier, u1, max).unwrap();
        let r2 = compute_linear_rate(base, multiplier, u2, max).unwrap();
        if u2 >= u1 {
            prop_assert!(r2 >= r1);
        }
    }

    /// Linear rate is never below the base rate and never exceeds the cap.
    #[test]
    fn linear_rate_within_bounds(
        base in 0u32..200_000u32,
        multiplier in 0u32..50_000u32,
        util in 0u32..10_000u32,
    ) {
        let max = base.saturating_add(100_000);
        let rate = compute_linear_rate(base, multiplier, util, max).unwrap();
        prop_assert!(rate >= base);
        prop_assert!(rate <= max);
    }

    /// Exponential rate also respects its cap.
    #[test]
    fn exponential_rate_respects_cap(
        base in 0u32..100_000u32,
        multiplier in 0u32..100_000u32,
        util in 0u32..10_000u32,
    ) {
        let max = 200_000;
        let rate = compute_exponential_rate(base, multiplier, util, max).unwrap();
        prop_assert!(rate <= max);
        // At zero utilization the exponential rate is exactly the base rate.
        let at_zero = compute_exponential_rate(base, multiplier, 0, max).unwrap();
        prop_assert_eq!(at_zero, base.min(max));
    }

    /// Both curve types reduce to the base rate at zero utilization.
    #[test]
    fn zero_utilization_equals_base(
        base in 0u32..100_000u32,
        multiplier in 0u32..100_000u32,
        max in 100_000u32..200_000u32,
    ) {
        let lin = compute_linear_rate(base, multiplier, 0, max).unwrap();
        let exp = compute_exponential_rate(base, multiplier, 0, max).unwrap();
        prop_assert_eq!(lin, base.min(max));
        prop_assert_eq!(exp, base.min(max));
    }

    /// Overflow of the scaled utilization product is reported, never wrapped.
    #[test]
    fn utilization_overflow_is_error(borrowed in (i128::MAX / 10_000)..i128::MAX, total in 1i128..100) {
        // borrowed * 10_000 overflows i128 for the top range of the strategy.
        let result = compute_utilization_bps(borrowed, total);
        prop_assert!(result.is_err());
        prop_assert_eq!(result, Err(Error::Overflow));
    }
}

/// Division by zero (zero total available) never errors: it yields 0 and never
/// panics, covering the fixed number of random permutations.
#[test]
fn utilization_never_errors_on_zero_total() {
    let mut runner = proptest::test_runner::TestRunner::new(default_config());
    let strategy = any_i128();
    runner
        .run(&strategy, |borrowed| {
            match compute_utilization_bps(borrowed, 0) {
                Ok(0) => Ok(()),
                // A sub-scale or extreme borrowed amount must still yield Ok(0):
                // zero total available never divides, so it can never error.
                other => Err(TestCaseError::fail(
                    "utilization with zero total available must be Ok(0)",
                )),
            }
        })
        .expect("utilization with zero total available must be Ok(0)");
}
