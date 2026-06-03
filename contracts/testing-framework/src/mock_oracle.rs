// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, Symbol};

/// Internal data stored for each asset.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub stale: bool,
}

/// A deployable mock oracle contract that stores price feeds keyed by
/// asset symbol.
///
/// Use this in tests to provide deterministic price data without
/// connecting to a real oracle network.  It supports a stale-data flag
/// so you can easily exercise error paths in your consuming contract.
///
/// # Stale Data Pattern
///
/// ```ignore
/// use soroban_sdk::{symbol_short, Env};
/// use testing_framework::mock_oracle::MockOracleClient;
///
/// let env = Env::default();
/// let contract_id = env.register_contract(None, MockOracle);
/// let oracle = MockOracleClient::new(&env, &contract_id);
///
/// // Set a fresh price
/// oracle.set_price(&symbol_short!("BTC"), &50_000i128);
/// assert_eq!(oracle.get_price(&symbol_short!("BTC")), 50_000);
/// assert!(!oracle.is_stale(&symbol_short!("BTC")));
///
/// // Simulate a stale feed
/// oracle.set_stale(&symbol_short!("BTC"));
/// assert!(oracle.is_stale(&symbol_short!("BTC")));
/// // Price is still readable (consumers decide how to handle staleness)
/// assert_eq!(oracle.get_price(&symbol_short!("BTC")), 50_000);
/// ```
#[contract]
pub struct MockOracle;

#[contractimpl]
impl MockOracle {
    /// Sets the price of `asset` to `price`.
    ///
    /// Any previous stale flag is cleared (the feed is considered fresh
    /// after a `set_price` call).
    pub fn set_price(env: Env, asset: Symbol, price: i128) {
        let data = PriceData { price, stale: false };
        env.storage().instance().set(&asset, &data);
        env.events().publish((symbol_short!("price_set"), asset), price);
    }

    /// Returns the current price for `asset`.
    ///
    /// # Panics
    ///
    /// Panics with a message like `"MockOracle: price not set for asset 'BTC'"`
    /// if `get_price` was never called for this asset.
    pub fn get_price(env: Env, asset: Symbol) -> i128 {
        let data: PriceData = env
            .storage()
            .instance()
            .get(&asset)
            .unwrap_or_else(|| {
                panic!("MockOracle: price not set for asset '{:?}'", asset)
            });
        data.price
    }

    /// Marks `asset` as stale to simulate an oracle outage or delayed
    /// update.
    ///
    /// The previously-set price is preserved so your contract can decide
    /// how to react (pause, use last-good price, revert, etc.).
    pub fn set_stale(env: Env, asset: Symbol) {
        let data: PriceData = env
            .storage()
            .instance()
            .get(&asset)
            .unwrap_or_else(|| PriceData { price: 0, stale: true });
        let updated = PriceData {
            price: data.price,
            stale: true,
        };
        env.storage().instance().set(&asset, &updated);
        env.events().publish((symbol_short!("stale_set"), asset), true);
    }

    /// Returns `true` if `asset` was marked stale via [`set_stale`](Self::set_stale).
    ///
    /// Returns `false` for assets that were never set (they are treated as
    /// not-stale by default).
    pub fn is_stale(env: Env, asset: Symbol) -> bool {
        env.storage()
            .instance()
            .get::<_, PriceData>(&asset)
            .map(|d| d.stale)
            .unwrap_or(false)
    }
}


