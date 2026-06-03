// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Soroban Testing Framework
//!
//! A reusable, standardised set of testing utilities for Soroban smart
//! contracts.  Use these components to write faster, more consistent tests
//! across all your contracts.
//!
//! ## Modules
//!
//! | Module | Description |
//! |--------|-------------|
//! | [`TestHarness`] | Pre-configured test environment with mock auth & ledger time |
//! | [`mock_oracle`] | Deployable mock oracle contract with stale-data simulation |
//! | [`mock_token`]  | Deployable SEP-41 compatible mock token contract |
//! | [`assertions`]  | Enhanced test assertions (`assert_near`, `assert_event`, etc.) |
//! | [`FuzzTester`]  | Property-based fuzzing strategies for Soroban types |
//!
//! ## Feature flags
//!
//! - `testutils` — enables Soroban SDK's test-only APIs.  Required when
//!   using [`TestHarness`] or [`FuzzTester`].
//!
//! ## Security
//!
//! **These utilities are for **testing only**.**  Do not deploy
//! `MockOracle`, `MockToken`, or any code from this crate to mainnet.
//! The mock contracts are intentionally simplified and lack production
//! security properties.

/// Pre-configured test environment wrapping [`soroban_sdk::Env`].
///
/// Requires the `testutils` feature.
#[cfg(feature = "testutils")]
pub mod harness;
#[cfg(feature = "testutils")]
pub use harness::TestHarness;

/// Deployable mock oracle contract with price-feed and stale-data
/// simulation.
pub mod mock_oracle;

/// Deployable SEP-41 compatible mock token contract.
pub mod mock_token;

/// Enhanced test assertion helpers.
pub mod assertions;
pub use assertions::{
    assert_auth_required, assert_event_emitted, assert_near, assert_panics,
};

/// Property-based fuzzing strategies for Soroban types.
///
/// Requires the `testutils` feature.
#[cfg(feature = "testutils")]
pub mod fuzz;
#[cfg(feature = "testutils")]
pub use fuzz::FuzzTester;

#[cfg(test)]
mod test;
