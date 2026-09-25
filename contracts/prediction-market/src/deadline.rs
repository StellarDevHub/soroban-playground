// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Deadline Module
//!
//! Provides a thin `TimeSource` abstraction over `env.ledger().timestamp()`.
//!
//! ## Why this exists
//!
//! Directly reading `env.ledger().timestamp()` inside business logic couples the
//! contract to the simulated clock of the Soroban test harness.  When tests need
//! to exercise *exact boundary* conditions (e.g. `now == deadline` or
//! `now == deadline + 1`) the harness clock must be advanced to a precise value
//! before every assertion, which is fragile and verbose.
//!
//! By routing all "what time is it?" calls through `TimeSource`, tests can:
//! - Use the real ledger time via `LedgerTimeSource` (production default).
//! - Inject a fixed timestamp via `FixedTimeSource` (unit tests).
//!
//! No production functionality changes; only the call-site changes from
//! `env.ledger().timestamp()` to `time_source.now(&env)`.

#![allow(dead_code)]

use soroban_sdk::Env;

// ── Trait ─────────────────────────────────────────────────────────────────────

/// Abstraction over the current time.
///
/// Production code uses [`LedgerTimeSource`]; tests can supply
/// [`FixedTimeSource`] or any custom implementation.
pub trait TimeSource {
    /// Returns the current Unix timestamp in seconds.
    fn now(&self, env: &Env) -> u64;
}

// ── Production implementation ─────────────────────────────────────────────────

/// Reads the ledger timestamp — the canonical production implementation.
#[derive(Clone, Copy, Default)]
pub struct LedgerTimeSource;

impl TimeSource for LedgerTimeSource {
    #[inline]
    fn now(&self, env: &Env) -> u64 {
        env.ledger().timestamp()
    }
}

// ── Test helper implementation ────────────────────────────────────────────────

/// Returns a fixed timestamp regardless of the ledger state.
///
/// Useful for injecting specific boundary values in unit tests without
/// advancing the harness clock.
///
/// # Example
///
/// ```rust
/// let ts = FixedTimeSource::new(1_000_000);
/// assert_eq!(ts.now(&env), 1_000_000);
/// ```
#[derive(Clone, Copy)]
pub struct FixedTimeSource {
    timestamp: u64,
}

impl FixedTimeSource {
    /// Create a `FixedTimeSource` that always returns `timestamp`.
    pub fn new(timestamp: u64) -> Self {
        Self { timestamp }
    }
}

impl TimeSource for FixedTimeSource {
    #[inline]
    fn now(&self, _env: &Env) -> u64 {
        self.timestamp
    }
}

// ── Deadline helpers ──────────────────────────────────────────────────────────

/// Returns `true` when `now >= deadline`, i.e. the deadline has been reached
/// or passed.
///
/// The `>=` semantics mean that a market whose deadline is **exactly** the
/// current ledger slot is already considered expired.  This matches the intent
/// of `create_market` which rejects `resolution_deadline <= env.ledger().timestamp()`.
#[inline]
pub fn is_past_deadline(source: &impl TimeSource, env: &Env, deadline: u64) -> bool {
    source.now(env) >= deadline
}

/// Returns `true` when `now < deadline`, i.e. the deadline has not yet been reached.
#[inline]
pub fn is_before_deadline(source: &impl TimeSource, env: &Env, deadline: u64) -> bool {
    source.now(env) < deadline
}

/// Returns the number of seconds until `deadline`, or 0 if the deadline has
/// already passed.
#[inline]
pub fn seconds_until_deadline(source: &impl TimeSource, env: &Env, deadline: u64) -> u64 {
    let now = source.now(env);
    if now < deadline { deadline - now } else { 0 }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Ledger as _, Env};

    // ── FixedTimeSource ───────────────────────────────────────────────────────

    #[test]
    fn fixed_source_returns_given_timestamp() {
        let env = Env::default();
        let ts = FixedTimeSource::new(999_999);
        assert_eq!(ts.now(&env), 999_999);
    }

    #[test]
    fn fixed_source_zero_timestamp() {
        let env = Env::default();
        let ts = FixedTimeSource::new(0);
        assert_eq!(ts.now(&env), 0);
    }

    #[test]
    fn fixed_source_max_u64() {
        let env = Env::default();
        let ts = FixedTimeSource::new(u64::MAX);
        assert_eq!(ts.now(&env), u64::MAX);
    }

    // ── LedgerTimeSource ──────────────────────────────────────────────────────

    #[test]
    fn ledger_source_matches_ledger_timestamp() {
        let env = Env::default();
        env.ledger().with_mut(|li| {
            li.timestamp = 1_700_000_000;
        });
        let ts = LedgerTimeSource;
        assert_eq!(ts.now(&env), 1_700_000_000);
    }

    #[test]
    fn ledger_source_reflects_updated_timestamp() {
        let env = Env::default();
        env.ledger().with_mut(|li| {
            li.timestamp = 100;
        });
        let ts = LedgerTimeSource;
        assert_eq!(ts.now(&env), 100);

        env.ledger().with_mut(|li| {
            li.timestamp = 200;
        });
        assert_eq!(ts.now(&env), 200);
    }

    // ── is_past_deadline ──────────────────────────────────────────────────────

    /// Strictly before deadline — not past.
    #[test]
    fn is_past_deadline_before() {
        let env = Env::default();
        let ts = FixedTimeSource::new(999);
        assert!(!is_past_deadline(&ts, &env, 1_000));
    }

    /// Exact boundary: now == deadline → past.
    #[test]
    fn is_past_deadline_at_exact_boundary() {
        let env = Env::default();
        let ts = FixedTimeSource::new(1_000);
        assert!(is_past_deadline(&ts, &env, 1_000));
    }

    /// One second past deadline → past.
    #[test]
    fn is_past_deadline_one_second_after() {
        let env = Env::default();
        let ts = FixedTimeSource::new(1_001);
        assert!(is_past_deadline(&ts, &env, 1_000));
    }

    /// Far future deadline → not past.
    #[test]
    fn is_past_deadline_far_future() {
        let env = Env::default();
        let ts = FixedTimeSource::new(1);
        assert!(!is_past_deadline(&ts, &env, u64::MAX));
    }

    // ── is_before_deadline ────────────────────────────────────────────────────

    #[test]
    fn is_before_deadline_strictly_before() {
        let env = Env::default();
        let ts = FixedTimeSource::new(500);
        assert!(is_before_deadline(&ts, &env, 1_000));
    }

    /// At exact boundary, before_deadline is false.
    #[test]
    fn is_before_deadline_at_exact_boundary() {
        let env = Env::default();
        let ts = FixedTimeSource::new(1_000);
        assert!(!is_before_deadline(&ts, &env, 1_000));
    }

    #[test]
    fn is_before_deadline_one_second_after() {
        let env = Env::default();
        let ts = FixedTimeSource::new(1_001);
        assert!(!is_before_deadline(&ts, &env, 1_000));
    }

    // ── seconds_until_deadline ────────────────────────────────────────────────

    #[test]
    fn seconds_until_deadline_in_future() {
        let env = Env::default();
        let ts = FixedTimeSource::new(900);
        assert_eq!(seconds_until_deadline(&ts, &env, 1_000), 100);
    }

    #[test]
    fn seconds_until_deadline_at_exact_boundary() {
        let env = Env::default();
        let ts = FixedTimeSource::new(1_000);
        assert_eq!(seconds_until_deadline(&ts, &env, 1_000), 0);
    }

    #[test]
    fn seconds_until_deadline_past_deadline() {
        let env = Env::default();
        let ts = FixedTimeSource::new(1_500);
        assert_eq!(seconds_until_deadline(&ts, &env, 1_000), 0);
    }

    #[test]
    fn seconds_until_deadline_zero_now_large_deadline() {
        let env = Env::default();
        let ts = FixedTimeSource::new(0);
        assert_eq!(seconds_until_deadline(&ts, &env, 86_400), 86_400);
    }
}
