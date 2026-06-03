# Soroban Testing Framework

A reusable, standardised set of testing utilities for Soroban smart
contracts.  Provides drop-in mock contracts, enhanced assertions, and
property-based fuzzing strategies so you can write consistent,
comprehensive tests across all your contracts without repeating
boilerplate.

---

## Modules

| Component         | Module              | Description                                       |
|-------------------|---------------------|---------------------------------------------------|
| **TestHarness**   | `TestHarness`       | Pre-configured `Env` with mock auth & ledger time |
| **MockOracle**    | `mock_oracle`       | Deployable price-feed oracle with stale-data sim  |
| **MockToken**     | `mock_token`        | SEP-41 compatible token with validation checks    |
| **TestAssertions**| `assertions`        | `assert_near`, `assert_event_emitted`, etc.       |
| **FuzzTester**    | `FuzzTester`        | `proptest` strategies for Address, Symbol, amount |

### TestHarness

Wraps `Env::default()` with mock authorisation enabled and a
non-zero ledger timestamp so every test starts from a consistent,
realistic environment.

### MockOracle

A deployable contract that stores price feeds keyed by asset symbol.
Use `set_stale(asset)` to simulate oracle outages and test how your
contract behaves when price data is stale.

### MockToken

A deployable SEP-41 compatible token that validates pre-conditions:
no negative amounts, no minting to the zero address, no burning more
than the balance, and `require_auth` on `from` in `transfer`.

### TestAssertions

Free functions for common test patterns:
- `assert_near` — approximate equality with tolerance
- `assert_event_emitted` — check that an event was fired
- `assert_auth_required` — assert that a call was rejected
- `assert_panics` — assert that a closure panics with a given message

### FuzzTester

Wraps `proptest` strategies for `Address`, `Symbol`, and `i128`
amounts.  Uses a fixed seed (`0xDEAD_BEEF_CAFE_0001`) for
reproducible CI runs.

---

## Quick Start

Add the framework as a **dev-dependency** in your contract's
`Cargo.toml`:

```toml
[dev-dependencies]
testing-framework = { path = "../testing-framework", features = ["testutils"] }
```

Then write a test that uses all three major utilities together:

```rust
#![cfg(test)]

use soroban_sdk::{testutils::Address as _, symbol_short, Address, Env};
use testing_framework::{
    TestHarness,
    mock_oracle::{MockOracle, MockOracleClient},
    mock_token::{MockToken, MockTokenClient},
    assert_near, assert_event_emitted,
};

#[test]
fn test_swap_with_oracle_price() {
    let harness = TestHarness::new();
    let env = harness.env();

    // Deploy mock contracts
    let oracle_id = env.register_contract(None, MockOracle);
    let oracle = MockOracleClient::new(env, &oracle_id);
    let token_id = env.register_contract(None, MockToken);
    let token = MockTokenClient::new(env, &token_id);

    // Set up accounts
    let alice = Address::generate(env);
    let bob = Address::generate(env);
    token.mint(&alice, &1_000_000);

    // Set oracle price
    oracle.set_price(&symbol_short!("BTC"), &60_000);

    // Transfer tokens based on oracle price
    token.transfer(&alice, &bob, &100_000);

    // Assert final state
    assert_eq!(token.balance(&alice), 900_000);
    assert_eq!(token.balance(&bob), 100_000);
    assert_eq!(oracle.get_price(&symbol_short!("BTC")), 60_000);
    assert_event_emitted(env, symbol_short!("transfer"), "transfer event");
}
```

---

## Adding to Another Contract

```toml
# In your contract's Cargo.toml
[dev-dependencies]
testing-framework = { path = "../testing-framework", features = ["testutils"] }
```

The `testutils` feature flag enables `TestHarness` and `FuzzTester` and
activates `soroban-sdk/testutils`.  Without it only `mock_oracle`,
`mock_token`, and `assertions` are available.

---

## Fuzz Testing

The framework provides a pre-configured `proptest` setup with a fixed
seed for reproducibility:

```rust
use testing_framework::FuzzTester;
use proptest::prelude::*;

proptest! {
    #![proptest_config = FuzzTester::run_fuzz()]

    #[test]
    fn test_with_random_amount(amount in FuzzTester::arb_amount()) {
        assert!(amount >= 0);
        assert!(amount < i128::MAX);
    }
}
```

---

## Security Notes

**These utilities are for testing only. Never deploy to mainnet.**

- `MockOracle` and `MockToken` are intentionally simplified and lack
  the security properties required for production use.
- `TestHarness` enables `mock_all_auths` which bypasses real
  authentication — never use this pattern outside of tests.
- The `testutils` feature of `soroban-sdk` (which this crate wraps)
  includes APIs that are only available in test environments.
- Always depend on this crate as a `[dev-dependency]`, never as a
  regular `[dependency]`, to prevent test-only code from leaking into
  production builds.
