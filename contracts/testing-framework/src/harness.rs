// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{testutils::Address as _, Address, Env};

/// A pre-configured test environment for Soroban contracts.
///
/// `TestHarness` wraps [`Env::default()`] and provides a consistent starting
/// point for every test: mock authentication is enabled and the ledger
/// carries a realistic initial timestamp.
///
/// # Quick Start
///
/// ```ignore
/// use testing_framework::TestHarness;
///
/// let harness = TestHarness::new();
/// let oracle = harness.env().register_contract(None, MockOracle);
/// ```
///
/// # ⚠ Environment Requirement
///
/// `TestHarness` requires the `testutils` feature of `soroban-sdk` to be
/// enabled.  If you see a compilation error about missing methods (`mock_all_auths`,
/// `with_mut`, etc.), add the `testutils` feature to your `testing-framework`
/// dependency:
///
/// ```toml
/// [dev-dependencies]
/// testing-framework = { path = "../testing-framework", features = ["testutils"] }
/// ```
pub struct TestHarness {
    env: Env,
}

impl TestHarness {
    /// Creates a new `TestHarness` with an initialised environment.
    ///
    /// Mock authentication is enabled for all addresses, and the ledger
    /// timestamp is set to a non-zero default so time-dependent logic can
    /// be exercised immediately.
    ///
    /// Panics if the `testutils` feature is not enabled.
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        // Set a non-zero timestamp so time-dependent code doesn't need
        // to advance from zero in every test.
        env.ledger().with_mut(|l| l.timestamp = 1000000);
        Self { env }
    }

    /// Returns a reference to the underlying [`Env`].
    ///
    /// Use this to register contracts, access storage, query ledger state,
    /// or inspect events.
    pub fn env(&self) -> &Env {
        &self.env
    }

    /// Sets the ledger timestamp to an absolute value (in seconds since
    /// Unix epoch).
    ///
    /// This is useful when a test needs to simulate a specific point in
    /// time, such as a deadline or vesting schedule.
    pub fn set_ledger_time(&self, timestamp: u64) {
        self.env.ledger().with_mut(|l| l.timestamp = timestamp);
    }

    /// Advances the ledger timestamp by `seconds`.
    ///
    /// This is equivalent to `set_ledger_time(current + seconds)` and is
    /// convenient for simulating the passage of time in a step-by-step
    /// fashion during multi-phase tests.
    ///
    /// # Panics
    ///
    /// Does not panic for normal inputs.  Overflow is saturating.
    pub fn advance_ledger(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp = l.timestamp.saturating_add(seconds);
        });
    }

    /// Re-enables mock authentication for the given `address`.
    ///
    /// Call this after manually revoking auth with
    /// [`env.mock_auth_address()`] if you need to restore the automatic
    /// authorization for a specific address.
    pub fn mock_auth(&self, address: &Address) {
        self.env.mock_auth(address);
    }
}

impl Default for TestHarness {
    fn default() -> Self {
        Self::new()
    }
}
