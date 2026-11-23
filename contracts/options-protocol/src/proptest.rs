//! Randomized algebraic checks for the fixed-point Black-Scholes calculator.

use proptest::prelude::*;

use crate::{
    math::{black_scholes, SCALE},
    GreeksInput, OptionKind,
};

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1_000))]

    #[test]
    fn call_and_put_greeks_satisfy_shared_invariants(
        spot_price in 10_000_000i128..100_000_000_000i128,
        strike_price in 10_000_000i128..100_000_000_000i128,
        volatility in 10_000i128..50_000_000i128,
        risk_free_rate in -20_000_000i128..20_000_000i128,
        time_to_expiry in 1u64..315_576_000u64,
    ) {
        let call = black_scholes(&GreeksInput {
            spot_price,
            strike_price,
            volatility,
            risk_free_rate,
            time_to_expiry,
            kind: OptionKind::Call,
        }).unwrap();
        let put = black_scholes(&GreeksInput {
            spot_price,
            strike_price,
            volatility,
            risk_free_rate,
            time_to_expiry,
            kind: OptionKind::Put,
        }).unwrap();

        prop_assert!(call.price >= 0);
        prop_assert!(put.price >= 0);
        prop_assert!(call.gamma >= 0);
        prop_assert!(put.gamma >= 0);
        prop_assert!(call.vega >= 0);
        prop_assert!(put.vega >= 0);
        prop_assert_eq!(call.gamma, put.gamma);
        prop_assert_eq!(call.vega, put.vega);
        prop_assert_eq!(call.delta - put.delta, SCALE);
    }
}
