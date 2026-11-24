// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
#![cfg(test)]

use crate::{
    storage,
    types::{AggregatedPrice, AggregationStrategy, Error},
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

use crate::{PriceFeedAggregator, PriceFeedAggregatorClient};
const STALE: Error = Error::StalePrice;

struct Harness {
    env: Env,
    id: Address,
    admin: Address,
}
impl Harness {
    fn new() -> Self {
        let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        env.ledger().set_timestamp(1000);
        let id = env.register_contract(None, PriceFeedAggregator);
        let admin = Address::generate(&env);
        let h = Self { env, id, admin };
        h.client().initialize(
            &h.admin,
            &String::from_str(&h.env, "XLM/USD"),
            &None,
            &None,
            &None,
            &None,
            &None,
        );
        h.bounds(1, 1000);
        h
    }
    fn client(&self) -> PriceFeedAggregatorClient<'_> {
        PriceFeedAggregatorClient::new(&self.env, &self.id)
    }
    fn bounds(&self, min: i128, max: i128) {
        self.client().set_price_bounds(&self.admin, &min, &max);
    }
    fn register(&self) -> (u32, Address) {
        let reporter = Address::generate(&self.env);
        let id = self.client().add_source(
            &self.admin,
            &reporter,
            &String::from_str(&self.env, "oracle"),
            &None,
        );
        (id, reporter)
    }
    fn source(&self, price: i128) -> (u32, Address) {
        let (id, reporter) = self.register();
        self.client().update_price(&reporter, &id, &price);
        (id, reporter)
    }
    fn submit(&self, reporter: &Address, id: u32, price: i128) -> Result<(), Error> {
        self.client()
            .try_update_price(reporter, &id, &price)
            .map(|v| v.unwrap())
            .map_err(|e| e.unwrap())
    }
    fn raw(&self, id: u32) -> Result<i128, Error> {
        self.client()
            .try_get_price(&id)
            .map(|v| v.unwrap().last_price)
            .map_err(|e| e.unwrap())
    }
    fn aggregate(&self) -> Result<AggregatedPrice, Error> {
        self.client()
            .try_get_aggregated_price()
            .map(|v| v.unwrap())
            .map_err(|e| e.unwrap())
    }
    fn inject(&self, id: u32, price: i128, timestamp: u64) {
        self.env.as_contract(&self.id, || {
            let mut source = storage::get_source(&self.env, id).unwrap();
            source.last_price = price;
            source.last_updated = timestamp;
            storage::set_source(&self.env, id, &source);
        });
    }
    fn clear_bounds(&self) {
        self.env.as_contract(&self.id, || {
            self.env
                .storage()
                .instance()
                .remove(&crate::types::InstanceKey::PriceBounds)
        });
    }
    fn duplicate_reporter(&self, id: u32, reporter: &Address) {
        self.env.as_contract(&self.id, || {
            let mut source = storage::get_source(&self.env, id).unwrap();
            source.reporter = reporter.clone();
            storage::set_source(&self.env, id, &source);
        });
    }
}

#[test]
fn requires_three_reporters_and_returns_unweighted_median() {
    let h = Harness::new();
    h.source(100);
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
    h.source(110);
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
    let (id, _) = h.source(101);
    h.client().set_weight(&h.admin, &id, &100);
    let result = h.aggregate().unwrap();
    assert_eq!(result.price, 101);
    assert_eq!(result.num_sources, 3);
    assert_eq!(result.timestamp, 1000);
}

#[test]
fn heartbeat_boundary_and_reads_do_not_refresh_rounds() {
    let h = Harness::new();
    let (id, _) = h.source(100);
    h.source(100);
    h.source(100);
    h.env.ledger().set_timestamp(4600);
    assert_eq!(h.raw(id), Ok(100));
    assert_eq!(h.aggregate().unwrap().timestamp, 1000);
    h.env.ledger().set_timestamp(4601);
    assert_eq!(h.raw(id), Err(STALE));
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
}

#[test]
fn negative_and_zero_submissions_revert_without_overwriting_price() {
    let h = Harness::new();
    let (id, reporter) = h.source(100);
    for price in [0, -1, i128::MIN] {
        assert_eq!(h.submit(&reporter, id, price), Err(Error::InvalidPrice));
        assert_eq!(h.raw(id), Ok(100));
    }
}

#[test]
fn rejects_first_out_of_band_round_and_preserves_existing_round() {
    let h = Harness::new();
    h.bounds(90, 110);
    let (id, reporter) = h.register();
    assert_eq!(h.submit(&reporter, id, 111), Err(Error::PriceOutOfBounds));
    assert!(h.raw(id).is_err());
    assert_eq!(h.submit(&reporter, id, 90), Ok(()));
    assert_eq!(h.submit(&reporter, id, 110), Ok(()));
    assert_eq!(h.submit(&reporter, id, 89), Err(Error::PriceOutOfBounds));
    assert_eq!(h.raw(id), Ok(110));
}

#[test]
fn stored_negative_future_and_out_of_band_rounds_cannot_be_consumed() {
    for (price, timestamp, expected) in [
        (-1, 1000, Error::InvalidPrice),
        (0, 1000, Error::InvalidPrice),
        (100, 1001, STALE),
        (1001, 1000, Error::PriceOutOfBounds),
    ] {
        let h = Harness::new();
        let (id, _) = h.source(100);
        h.source(100);
        h.source(100);
        h.inject(id, price, timestamp);
        assert_eq!(h.raw(id), Err(expected));
        assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
    }
}

#[test]
fn changed_bands_revalidate_previously_accepted_rounds() {
    let h = Harness::new();
    let (id, _) = h.source(100);
    h.source(100);
    h.source(100);
    assert_eq!(h.aggregate().unwrap().price, 100);
    h.bounds(101, 200);
    assert_eq!(h.raw(id), Err(Error::PriceOutOfBounds));
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
}

#[test]
fn quorum_is_rechecked_after_outlier_filtering() {
    let h = Harness::new();
    h.source(100);
    h.source(101);
    h.source(1000);
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
    h.source(102);
    let result = h.aggregate().unwrap();
    assert_eq!(result.price, 101);
    assert_eq!(result.num_sources, 3);
}

#[test]
fn stale_source_is_excluded_but_three_fresh_sources_still_work() {
    let h = Harness::new();
    h.source(100);
    h.env.ledger().set_timestamp(4601);
    h.source(101);
    h.source(102);
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
    h.source(103);
    let result = h.aggregate().unwrap();
    assert_eq!(result.price, 102);
    assert_eq!(result.num_sources, 3);
    assert_eq!(result.timestamp, 4601);
}

#[test]
fn removed_source_and_pause_block_price_consumption() {
    let h = Harness::new();
    let (id, reporter) = h.source(100);
    h.source(100);
    h.source(100);
    h.client().pause(&h.admin);
    assert_eq!(h.raw(id), Err(Error::ContractPaused));
    assert_eq!(h.aggregate(), Err(Error::ContractPaused));
    assert_eq!(h.submit(&reporter, id, 100), Err(Error::ContractPaused));
    h.client().unpause(&h.admin);
    assert_eq!(h.aggregate().unwrap().price, 100);
    h.client().remove_source(&h.admin, &id);
    assert_eq!(h.raw(id), Err(Error::SourceInactive));
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
}

#[test]
fn unauthorized_reporter_cannot_replace_a_round() {
    let h = Harness::new();
    let (id, _) = h.source(100);
    assert_eq!(
        h.submit(&Address::generate(&h.env), id, 105),
        Err(Error::Unauthorized)
    );
    assert_eq!(h.raw(id), Ok(100));
}

#[test]
fn missing_bounds_fail_closed_on_reads_and_submissions() {
    let h = Harness::new();
    let (id, reporter) = h.source(100);
    h.clear_bounds();
    assert_eq!(h.submit(&reporter, id, 100), Err(Error::PriceBoundsNotSet));
    assert_eq!(h.raw(id), Err(Error::PriceBoundsNotSet));
    assert_eq!(h.aggregate(), Err(Error::PriceBoundsNotSet));
}

#[test]
fn nonmedian_strategy_cannot_be_enabled_or_consumed_from_legacy_config() {
    let h = Harness::new();
    for strategy in [
        AggregationStrategy::WeightedAverage,
        AggregationStrategy::TrimmedMean,
    ] {
        assert_eq!(
            h.client().try_set_strategy(&h.admin, &strategy),
            Err(Ok(Error::InvalidParameter))
        );
    }
    h.source(100);
    h.source(100);
    h.source(100);
    h.env.as_contract(&h.id, || {
        storage::set_strategy(&h.env, AggregationStrategy::WeightedAverage);
    });
    assert_eq!(h.aggregate(), Err(Error::InvalidParameter));
}

#[test]
fn legacy_overlong_heartbeat_is_capped_at_one_hour() {
    let h = Harness::new();
    let (id, _) = h.source(100);
    h.source(100);
    h.source(100);
    h.env
        .as_contract(&h.id, || storage::set_max_price_age(&h.env, 86400));
    h.env.ledger().set_timestamp(4601);
    assert_eq!(h.raw(id), Err(STALE));
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
}

#[test]
fn extreme_positive_prices_do_not_overflow_median_or_deviation() {
    let h = Harness::new();
    h.bounds(1, i128::MAX);
    let (id, reporter) = h.source(i128::MAX - 6);
    h.source(i128::MAX - 4);
    h.source(i128::MAX - 2);
    h.source(i128::MAX);
    assert_eq!(h.aggregate().unwrap().price, i128::MAX - 3);
    assert_eq!(h.submit(&reporter, id, i128::MAX - 5), Ok(()));
    assert_eq!(h.aggregate().unwrap().price, i128::MAX - 3);
}

#[test]
fn even_median_rounds_down_without_weight_bias() {
    let h = Harness::new();
    for price in [100, 103, 106, 109] {
        h.source(price);
    }
    assert_eq!(h.aggregate().unwrap().price, 104);
}

#[test]
fn legacy_duplicate_reporter_cannot_supply_quorum() {
    let h = Harness::new();
    let (first, reporter) = h.source(100);
    let (second, _) = h.source(100);
    h.source(100);
    h.duplicate_reporter(second, &reporter);
    assert_eq!(h.raw(first), Ok(100));
    assert_eq!(h.aggregate(), Err(Error::InsufficientSources));
}

#[test]
fn metadata_administration_still_requires_admin_and_valid_weights() {
    let h = Harness::new();
    let (id, _) = h.source(100);
    let other = Address::generate(&h.env);
    assert_eq!(h.client().try_pause(&other), Err(Ok(Error::Unauthorized)));
    assert_eq!(
        h.client().try_remove_source(&other, &id),
        Err(Ok(Error::Unauthorized))
    );
    assert_eq!(
        h.client().try_set_weight(&other, &id, &1),
        Err(Ok(Error::Unauthorized))
    );
    for weight in [0, 101] {
        assert_eq!(
            h.client().try_set_weight(&h.admin, &id, &weight),
            Err(Ok(Error::InvalidWeight))
        );
    }
}

#[test]
fn prevents_duplicate_registration_and_bounds_source_count() {
    let h = Harness::new();
    let (_, reporter) = h.register();
    assert_eq!(
        h.client().try_add_source(
            &h.admin,
            &reporter,
            &String::from_str(&h.env, "duplicate"),
            &None
        ),
        Err(Ok(Error::DuplicateReporter))
    );
    for _ in 1..32 {
        h.register();
    }
    assert_eq!(
        h.client().try_add_source(
            &h.admin,
            &Address::generate(&h.env),
            &String::from_str(&h.env, "overflow"),
            &None
        ),
        Err(Ok(Error::MaxSourcesReached))
    );
}

#[test]
fn initialization_and_setters_reject_unsafe_configuration() {
    let env = Env::new_with_config(soroban_sdk::testutils::EnvTestConfig {
        capture_snapshot_at_drop: false,
    });
    env.mock_all_auths();
    let id = env.register_contract(None, PriceFeedAggregator);
    let client = PriceFeedAggregatorClient::new(&env, &id);
    let admin = Address::generate(&env);
    for age in [0, 3601, u64::MAX] {
        assert_eq!(
            client.try_initialize(
                &admin,
                &String::from_str(&env, "XLM/USD"),
                &None,
                &Some(age),
                &None,
                &None,
                &None
            ),
            Err(Ok(Error::InvalidParameter))
        );
    }
    for strategy in [
        AggregationStrategy::WeightedAverage,
        AggregationStrategy::TrimmedMean,
    ] {
        assert_eq!(
            client.try_initialize(
                &admin,
                &String::from_str(&env, "XLM/USD"),
                &None,
                &None,
                &None,
                &None,
                &Some(strategy)
            ),
            Err(Ok(Error::InvalidParameter))
        );
    }
    client.initialize(
        &admin,
        &String::from_str(&env, "XLM/USD"),
        &None,
        &Some(60),
        &None,
        &None,
        &None,
    );
    assert_eq!(
        client.try_initialize(
            &admin,
            &String::from_str(&env, "XLM/USD"),
            &None,
            &None,
            &None,
            &None,
            &None
        ),
        Err(Ok(Error::AlreadyInitialized))
    );
    for age in [0, 3601] {
        assert_eq!(
            client.try_set_max_price_age(&admin, &age),
            Err(Ok(Error::InvalidParameter))
        );
    }
    for (min, max) in [(0, 1), (-1, 10), (10, 9)] {
        assert_eq!(
            client.try_set_price_bounds(&admin, &min, &max),
            Err(Ok(Error::InvalidParameter))
        );
    }
    assert_eq!(
        client.try_set_price_bounds(&Address::generate(&env), &1, &100),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn source_swing_breaker_preserves_previous_round() {
    let h = Harness::new();
    let (id, reporter) = h.source(100);
    assert_eq!(
        h.submit(&reporter, id, 131),
        Err(Error::CircuitBreakerTripped)
    );
    assert_eq!(h.raw(id), Ok(100));
    assert_eq!(h.submit(&reporter, id, 130), Ok(()));
}

#[test]
fn custom_heartbeat_can_be_stricter_than_one_hour() {
    let h = Harness::new();
    h.client().set_max_price_age(&h.admin, &60);
    let (id, _) = h.source(100);
    h.env.ledger().set_timestamp(1060);
    assert_eq!(h.raw(id), Ok(100));
    h.env.ledger().set_timestamp(1061);
    assert_eq!(h.raw(id), Err(STALE));
}

#[test]
fn correct_reporter_address_without_authorization_cannot_submit() {
    let h = Harness::new();
    let (id, reporter) = h.source(100);
    h.env.mock_auths(&[]);
    assert!(h.client().try_update_price(&reporter, &id, &105).is_err());
    assert_eq!(h.raw(id), Ok(100));
}
