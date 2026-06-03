// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use proptest::strategy::Strategy;
use proptest::test_runner::Config;
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

/// Fixed 32-byte seed for reproducible fuzzing runs.
const FUZZ_SEED: [u8; 32] = [
    0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/// A collection of property-based testing utilities for Soroban contracts.
///
/// Provides common [`Strategy`] implementations for Soroban types so you
/// can write fuzz tests with [`proptest`] without repeating boilerplate.
///
/// # Reproducibility
///
/// All strategies produced by this struct use a fixed default seed so that
/// fuzzing runs are deterministic across CI executions.
///
/// # Quick Start
///
/// ```ignore
/// use soroban_sdk::Env;
/// use testing_framework::FuzzTester;
/// use proptest::prelude::*;
///
/// proptest! {
///     #![proptest_config = FuzzTester::run_fuzz()]
///     #[test]
///     fn test_with_random_amount(amount in FuzzTester::arb_amount()) {
///         assert!(amount >= 0);
///     }
/// }
/// ```
pub struct FuzzTester;

impl FuzzTester {
    /// Returns a strategy that generates random [`Address`] values using
    /// the given [`Env`].
    ///
    /// Each generated address is distinct and cryptographically random
    /// (via the test environment's PRNG).
    ///
    /// # Note
    ///
    /// This function requires the `testutils` feature of `soroban-sdk`.
    /// It is safe to call from test code only.
    pub fn arb_address(env: &Env) -> impl Strategy<Value = Address> {
        let e = env.clone();
        (0..100u32).prop_map(move |_| Address::generate(&e)).no_shrink()
    }

    /// Returns a strategy that generates random `i128` values in the
    /// range `[0, i128::MAX)`.
    ///
    /// Useful for generating token amounts, prices, or other unsigned
    /// financial values.
    pub fn arb_amount() -> impl Strategy<Value = i128> {
        (0..i128::MAX).no_shrink()
    }

    /// Returns a strategy that generates random short [`Symbol`] values.
    ///
    /// Each symbol is built from alphanumeric ASCII characters and has
    /// length between 1 and 8.
    pub fn arb_symbol(env: &Env) -> impl Strategy<Value = Symbol> {
        let e = env.clone();
        proptest::string::string_regex("[a-zA-Z][a-zA-Z0-9]{0,7}")
            .expect("FuzzTester: invalid regex for arb_symbol")
            .prop_map(move |s| {
                let mut vec = soroban_sdk::Vec::new(&e);
                for &b in s.as_bytes() {
                    vec.push_back(b);
                }
                Symbol::from_bytes(&e, &vec)
            })
            .no_shrink()
    }

    /// Returns a [`proptest::test_runner::Config`] with a fixed seed for
    /// reproducible fuzzing runs.
    ///
    /// Use this as the `proptest_config` attribute value:
    ///
    /// ```ignore
    /// proptest! {
    ///     #![proptest_config = FuzzTester::run_fuzz()]
    ///     // ...
    /// }
    /// ```
    pub fn run_fuzz() -> Config {
        Config {
            cases: 256,
            failure_persistence: None,
            source_file: None,
            fork: false,
            ..Config::with_seed(FUZZ_SEED)
        }
    }
}
