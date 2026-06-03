// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Env, Symbol};

/// Asserts that `actual` is within `tolerance` of `expected`.
///
/// The assertion passes when `|actual - expected| <= tolerance`.
///
/// # Panics
///
/// Panics with a detailed message showing the actual and expected values
/// and their difference.
///
/// # Example
///
/// ```ignore
/// use testing_framework::assert_near;
///
/// assert_near(105, 100, 10, "price should be ~100");
/// // passes because |105 - 100| = 5 ≤ 10
/// ```
pub fn assert_near(actual: i128, expected: i128, tolerance: i128, msg: &str) {
    let diff = if actual > expected {
        actual - expected
    } else {
        expected - actual
    };
    if diff > tolerance {
        panic!(
            "ASSERTION FAILED: {} — expected {} ± {}, got {} (diff = {})",
            msg, expected, tolerance, actual, diff
        );
    }
}

/// Asserts that an event with the given `topic` was emitted by `env`.
///
/// This searches through all events recorded in `env` and checks whether
/// the first element of the event's topics vector matches `topic`.
///
/// # Panics
///
/// Panics with a message listing the topics that were actually emitted
/// so the developer can diagnose the mismatch.
///
/// # Example
///
/// ```ignore
/// use soroban_sdk::{symbol_short, Env};
/// use testing_framework::assert_event_emitted;
///
/// let env = Env::default();
/// env.mock_all_auths();
/// // ... do something that emits a "transfer" event ...
/// assert_event_emitted(&env, symbol_short!("transfer"), "transfer should fire");
/// ```
pub fn assert_event_emitted(env: &Env, topic: Symbol, msg: &str) {
    let events = env.events().all();
    for event in events.iter() {
        let (topics, _) = event;
        if let Some(first) = topics.get(0) {
            if first == topic.into() {
                return;
            }
        }
    }
    // Build a list of topics that were emitted
    let mut emitted: Vec<String> = Vec::new();
    for event in events.iter() {
        let (topics, _) = event;
        if let Some(t) = topics.get(0) {
            let s = format!("{:?}", t);
            emitted.push(s);
        }
    }
    panic!(
        "ASSERTION FAILED: {} — expected event with topic '{:?}', \
         but it was not emitted. Emitted topics: [{}]",
        msg,
        topic,
        emitted.join(", ")
    );
}

/// Asserts that a `Result` is an `Err` caused by an authorisation failure.
///
/// This is a loose check — it passes if the result is any `Err` variant.
/// Use it to quickly verify that unauthorised calls are rejected.
///
/// # Panics
///
/// Panics with a message showing the unexpected `Ok` value.
///
/// # Example
///
/// ```ignore
/// use testing_framework::assert_auth_required;
///
/// let result = contract.some_admin_only_fn(&unauthorised_user);
/// assert_auth_required(&result, "non-admin should be rejected");
/// ```
pub fn assert_auth_required<T, E>(result: &Result<T, E>, msg: &str) {
    if result.is_ok() {
        panic!(
            "ASSERTION FAILED: {} — expected auth failure, but call succeeded",
            msg
        );
    }
}

/// Asserts that the given closure `f` panics with a message containing
/// `expected_msg`.
///
/// Uses [`std::panic::catch_unwind`] internally.
///
/// # Panics
///
/// Panics if `f` does not panic, or if the panic message does not contain
/// `expected_msg`.
///
/// # Example
///
/// ```ignore
/// use testing_framework::assert_panics;
///
/// assert_panics(
///     || panic!("something went wrong"),
///     "went wrong",
///     "expected a panic with 'went wrong'",
/// );
/// ```
pub fn assert_panics(f: impl FnOnce() + std::panic::UnwindSafe, expected_msg: &str, msg: &str) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    match result {
        Ok(()) => {
            panic!(
                "ASSERTION FAILED: {} — expected panic with message containing '{}', \
                 but closure did not panic",
                msg, expected_msg
            );
        }
        Err(payload) => {
            let actual_msg = if let Some(s) = payload.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.clone()
            } else {
                format!("{:?}", payload)
            };
            if !actual_msg.contains(expected_msg) {
                panic!(
                    "ASSERTION FAILED: {} — expected panic message to contain '{}', \
                     but actual message was '{}'",
                    msg, expected_msg, actual_msg
                );
            }
        }
    }
}
