//! Property-based invariant tests for the constant-product swap math
//! (Issue #1565).
//!
//! The swap curve is the one piece of this contract where a rounding mistake
//! is a solvency mistake: an output one unit too large, repeated, drains the
//! pool. Example-based tests confirm a handful of chosen numbers; these assert
//! the properties that must hold for *every* reserve and trade size, which is
//! where curve bugs actually live.
//!
//! Each property runs 10,000 permutations.

#![cfg(test)]

use proptest::prelude::*;

use crate::types::Error;
use crate::{constant_product_amount_out, utilization_bps, BPS};

fn default_config() -> ProptestConfig {
    ProptestConfig::with_cases(10_000)
}

/// Reserve sizes that stay inside `i128` once multiplied by `BPS` and by the
/// opposing reserve, so an overflow here means a real bug rather than an
/// input no pool could hold.
fn reserve() -> impl Strategy<Value = i128> {
    1i128..1_000_000_000_000i128
}

/// Trade sizes over the same range, including trades far larger than the pool.
fn trade() -> impl Strategy<Value = i128> {
    1i128..1_000_000_000_000i128
}

/// Fees from zero to 10%, the range the contract's own validation permits.
fn fee_bps() -> impl Strategy<Value = i128> {
    0i128..=1_000i128
}

proptest! {
    #![proptest_config(default_config())]

    /// The output can never exceed the output reserve.
    ///
    /// This is the solvency invariant: paying out more than the pool holds is
    /// the failure that empties it, and the constant-product form is supposed
    /// to make it structurally impossible rather than merely unlikely.
    #[test]
    fn output_never_exceeds_output_reserve(
        amount_in in trade(),
        ra in reserve(),
        rb in reserve(),
        fee in fee_bps(),
    ) {
        let out = constant_product_amount_out(amount_in, ra, rb, fee).unwrap();
        prop_assert!(out < rb, "output {out} drained reserve {rb}");
    }

    /// Output is never negative.
    #[test]
    fn output_never_negative(
        amount_in in trade(),
        ra in reserve(),
        rb in reserve(),
        fee in fee_bps(),
    ) {
        prop_assert!(constant_product_amount_out(amount_in, ra, rb, fee).unwrap() >= 0);
    }

    /// The constant-product invariant does not decrease.
    ///
    /// `k = ra * rb` after the swap must be at least what it was before, or
    /// the pool has given away value. Equality is only reachable with a zero
    /// fee and exact division; anything below it is a leak.
    #[test]
    fn invariant_never_decreases(
        amount_in in 1i128..1_000_000i128,
        ra in 1_000i128..1_000_000_000i128,
        rb in 1_000i128..1_000_000_000i128,
        fee in fee_bps(),
    ) {
        let out = constant_product_amount_out(amount_in, ra, rb, fee).unwrap();

        // Reserves are capped at 1e9 for this property so `ra * rb` stays
        // under 1e18 and cannot overflow `i128`. Letting it overflow would
        // fail the test on arithmetic the contract never performs, which
        // would say nothing about the contract.
        let k_before = ra * rb;
        let k_after = (ra + amount_in) * (rb - out);
        prop_assert!(k_after >= k_before, "invariant fell: {k_before} -> {k_after}");
    }

    /// A larger trade never returns less output, holding reserves and fee
    /// fixed. A non-monotonic curve would let a trader split an order and
    /// extract more than the curve intends.
    #[test]
    fn output_is_monotonic_in_input(
        smaller in 1i128..1_000_000i128,
        delta in 1i128..1_000_000i128,
        ra in 1_000i128..1_000_000_000i128,
        rb in 1_000i128..1_000_000_000i128,
        fee in fee_bps(),
    ) {
        let a = constant_product_amount_out(smaller, ra, rb, fee).unwrap();
        let b = constant_product_amount_out(smaller + delta, ra, rb, fee).unwrap();
        prop_assert!(b >= a, "output fell from {a} to {b} on a larger trade");
    }

    /// A higher fee never returns more output.
    #[test]
    fn output_decreases_with_fee(
        amount_in in 1i128..1_000_000i128,
        ra in 1_000i128..1_000_000_000i128,
        rb in 1_000i128..1_000_000_000i128,
        low in 0i128..=500i128,
        extra in 1i128..=500i128,
    ) {
        let cheap = constant_product_amount_out(amount_in, ra, rb, low).unwrap();
        let dear = constant_product_amount_out(amount_in, ra, rb, low + extra).unwrap();
        prop_assert!(dear <= cheap, "a higher fee returned more: {dear} > {cheap}");
    }

    /// Output never exceeds the ideal (zero-slippage, zero-fee) amount.
    ///
    /// Exceeding the spot quote would mean the pool priced the trade better
    /// than an infinitely deep market, which is value leaving the pool.
    #[test]
    fn output_never_beats_spot_price(
        amount_in in 1i128..1_000_000i128,
        ra in 1_000i128..1_000_000_000i128,
        rb in 1_000i128..1_000_000_000i128,
        fee in fee_bps(),
    ) {
        let out = constant_product_amount_out(amount_in, ra, rb, fee).unwrap();
        let ideal = amount_in.saturating_mul(rb) / ra;
        prop_assert!(out <= ideal, "output {out} beat the spot quote {ideal}");
    }

    /// An empty reserve is an explicit error, never a panic or a zero quote
    /// that a caller might act on.
    #[test]
    fn empty_reserve_is_an_error(amount_in in trade(), r in reserve(), fee in fee_bps()) {
        prop_assert_eq!(
            constant_product_amount_out(amount_in, 0, r, fee),
            Err(Error::InsufficientLiquidity)
        );
        prop_assert_eq!(
            constant_product_amount_out(amount_in, r, 0, fee),
            Err(Error::InsufficientLiquidity)
        );
    }

    /// Utilization stays within basis-point bounds for any trade against any
    /// reserve. It feeds the dynamic fee, so a value above `BPS` would make
    /// the fee exceed its configured ceiling before clamping.
    #[test]
    fn utilization_within_bounds(amount_in in trade(), reserve_in in reserve()) {
        let util = utilization_bps(amount_in, reserve_in).unwrap();
        prop_assert!((0..=BPS).contains(&util), "utilization {util} out of range");
    }

    /// Utilization rises with trade size against a fixed reserve.
    #[test]
    fn utilization_is_monotonic(
        smaller in 1i128..1_000_000i128,
        delta in 1i128..1_000_000i128,
        reserve_in in 1_000i128..1_000_000_000i128,
    ) {
        let a = utilization_bps(smaller, reserve_in).unwrap();
        let b = utilization_bps(smaller + delta, reserve_in).unwrap();
        prop_assert!(b >= a);
    }
}
