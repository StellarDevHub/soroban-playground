// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::types::{AggregationStrategy, Error};
use crate::{PriceFeedAggregator, PriceFeedAggregatorClient};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, PriceFeedAggregatorClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PriceFeedAggregator);
    let client = PriceFeedAggregatorClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn asset(env: &Env) -> String {
    String::from_str(env, "XLM/USD")
}

fn desc(env: &Env) -> String {
    String::from_str(env, "Binance XLM/USD")
}

fn init(env: &Env, admin: &Address, client: &PriceFeedAggregatorClient) {
    client
        .initialize(admin, &asset(env), &None, &None, &None, &None, &None)
        .unwrap();
}

fn advance(env: &Env, seconds: u64) {
    env.ledger().with_mut(|l| l.timestamp += seconds);
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    assert_eq!(client.get_admin().unwrap(), admin);
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    assert_eq!(
        client.initialize(&admin, &asset(&env), &None, &None, &None, &None, &None),
        Err(Error::AlreadyInitialized)
    );
}

#[test]
fn test_not_initialized_error() {
    let (env, admin, client) = setup();
    let reporter = Address::generate(&env);
    assert_eq!(
        client.update_price(&reporter, &0, &100_000_000),
        Err(Error::NotInitialized)
    );
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    client.pause(&admin).unwrap();
    assert!(client.is_paused());
    client.unpause(&admin).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_update_price() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.pause(&admin).unwrap();
    assert_eq!(
        client.update_price(&reporter, &0, &100_000_000),
        Err(Error::ContractPaused)
    );
}

#[test]
fn test_pause_blocks_add_source() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    client.pause(&admin).unwrap();
    let reporter = Address::generate(&env);
    assert_eq!(
        client.add_source(&admin, &reporter, &desc(&env), &None),
        Err(Error::ContractPaused)
    );
}

#[test]
fn test_non_admin_cannot_pause() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let other = Address::generate(&env);
    assert_eq!(client.pause(&other), Err(Error::Unauthorized));
}

// ── add_source ────────────────────────────────────────────────────────────────

#[test]
fn test_add_source_ok() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    let id = client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    assert_eq!(id, 0);
    assert_eq!(client.get_source_count(), 1);
    let src = client.get_price(&0).unwrap();
    assert_eq!(src.reporter, reporter);
    assert!(src.active);
    assert_eq!(src.weight, 1);
}

#[test]
fn test_add_source_with_weight() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &Some(50)).unwrap();
    assert_eq!(client.get_price(&0).unwrap().weight, 50);
}

#[test]
fn test_add_source_invalid_weight() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    assert_eq!(
        client.add_source(&admin, &reporter, &desc(&env), &Some(0)),
        Err(Error::InvalidWeight)
    );
    assert_eq!(
        client.add_source(&admin, &reporter, &desc(&env), &Some(101)),
        Err(Error::InvalidWeight)
    );
}

#[test]
fn test_add_source_non_admin_fails() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let other = Address::generate(&env);
    assert_eq!(
        client.add_source(&other, &other, &desc(&env), &None),
        Err(Error::Unauthorized)
    );
}

// ── remove_source ─────────────────────────────────────────────────────────────

#[test]
fn test_remove_source_deactivates() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.remove_source(&admin, &0).unwrap();
    assert!(!client.get_price(&0).unwrap().active);
}

#[test]
fn test_remove_nonexistent_source_fails() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    assert_eq!(client.remove_source(&admin, &99), Err(Error::SourceNotFound));
}

// ── set_weight ────────────────────────────────────────────────────────────────

#[test]
fn test_set_weight_ok() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.set_weight(&admin, &0, &75).unwrap();
    assert_eq!(client.get_price(&0).unwrap().weight, 75);
}

#[test]
fn test_set_weight_invalid() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    assert_eq!(client.set_weight(&admin, &0, &0), Err(Error::InvalidWeight));
    assert_eq!(client.set_weight(&admin, &0, &101), Err(Error::InvalidWeight));
}

// ── update_price ──────────────────────────────────────────────────────────────

#[test]
fn test_update_price_ok() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.update_price(&reporter, &0, &1_000_000_0).unwrap();
    assert_eq!(client.get_price(&0).unwrap().last_price, 1_000_000_0);
}

#[test]
fn test_update_price_invalid() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    assert_eq!(
        client.update_price(&reporter, &0, &0),
        Err(Error::InvalidPrice)
    );
    assert_eq!(
        client.update_price(&reporter, &0, &-5),
        Err(Error::InvalidPrice)
    );
}

#[test]
fn test_update_price_wrong_reporter() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    let other = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    assert_eq!(
        client.update_price(&other, &0, &1_000_000_0),
        Err(Error::Unauthorized)
    );
}

#[test]
fn test_update_price_inactive_source() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.remove_source(&admin, &0).unwrap();
    assert_eq!(
        client.update_price(&reporter, &0, &1_000_000_0),
        Err(Error::SourceInactive)
    );
}

#[test]
fn test_circuit_breaker_trips_on_large_swing() {
    let (env, admin, client) = setup();
    // circuit_breaker = 3000 bps (30%)
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.update_price(&reporter, &0, &1_000_000_0).unwrap();
    // 50% move — should trip
    assert_eq!(
        client.update_price(&reporter, &0, &1_500_000_0),
        Err(Error::CircuitBreakerTripped)
    );
}

#[test]
fn test_circuit_breaker_allows_small_swing() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.update_price(&reporter, &0, &1_000_000_0).unwrap();
    // 10% move — within 30% limit
    client.update_price(&reporter, &0, &1_100_000_0).unwrap();
    assert_eq!(client.get_price(&0).unwrap().last_price, 1_100_000_0);
}

// ── get_aggregated_price – Median ─────────────────────────────────────────────

#[test]
fn test_aggregated_price_single_source() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let reporter = Address::generate(&env);
    client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
    client.update_price(&reporter, &0, &1_000_000_0).unwrap();
    let agg = client.get_aggregated_price().unwrap();
    assert_eq!(agg.price, 1_000_000_0);
    assert_eq!(agg.num_sources, 1);
}

#[test]
fn test_aggregated_price_median_odd() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    for (price, i) in [(1_000_000_0i128, 0u32), (1_200_000_0, 1), (1_100_000_0, 2)] {
        let reporter = Address::generate(&env);
        client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
        client.update_price(&reporter, &i, &price).unwrap();
    }
    let agg = client.get_aggregated_price().unwrap();
    assert_eq!(agg.price, 1_100_000_0); // median of 10M, 11M, 12M
    assert_eq!(agg.num_sources, 3);
}

#[test]
fn test_aggregated_price_median_even() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    for (price, i) in [(1_000_000_0i128, 0u32), (1_200_000_0, 1), (1_100_000_0, 2), (1_300_000_0, 3)] {
        let reporter = Address::generate(&env);
        client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
        client.update_price(&reporter, &i, &price).unwrap();
    }
    let agg = client.get_aggregated_price().unwrap();
    assert_eq!(agg.price, (1_100_000_0 + 1_200_000_0) / 2);
}

#[test]
fn test_aggregated_price_no_sources_fails() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    assert_eq!(
        client.get_aggregated_price(),
        Err(Error::InsufficientSources)
    );
}

#[test]
fn test_aggregated_price_excludes_stale() {
    let (env, admin, client) = setup();
    // max_price_age = 60s
    client
        .initialize(&admin, &asset(&env), &None, &Some(60), &None, &None, &None)
        .unwrap();
    let r0 = Address::generate(&env);
    let r1 = Address::generate(&env);
    client.add_source(&admin, &r0, &desc(&env), &None).unwrap();
    client.add_source(&admin, &r1, &desc(&env), &None).unwrap();
    client.update_price(&r0, &0, &1_000_000_0).unwrap();
    client.update_price(&r1, &1, &1_200_000_0).unwrap();
    // advance past max_price_age for source 0
    advance(&env, 120);
    client.update_price(&r1, &1, &1_200_000_0).unwrap(); // refresh source 1
    let agg = client.get_aggregated_price().unwrap();
    assert_eq!(agg.num_sources, 1);
    assert_eq!(agg.price, 1_200_000_0);
}

#[test]
fn test_aggregated_price_excludes_inactive() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    let r0 = Address::generate(&env);
    let r1 = Address::generate(&env);
    client.add_source(&admin, &r0, &desc(&env), &None).unwrap();
    client.add_source(&admin, &r1, &desc(&env), &None).unwrap();
    client.update_price(&r0, &0, &1_000_000_0).unwrap();
    client.update_price(&r1, &1, &1_200_000_0).unwrap();
    client.remove_source(&admin, &0).unwrap();
    let agg = client.get_aggregated_price().unwrap();
    assert_eq!(agg.num_sources, 1);
    assert_eq!(agg.price, 1_200_000_0);
}

// ── Outlier detection ─────────────────────────────────────────────────────────

#[test]
fn test_outlier_detection_filters_extreme_value() {
    let (env, admin, client) = setup();
    // outlier_bps = 1000 (10%)
    client
        .initialize(&admin, &asset(&env), &None, &None, &Some(1000), &None, &None)
        .unwrap();
    for (price, i) in [(1_000_000_0i128, 0u32), (1_050_000_0, 1), (5_000_000_0, 2)] {
        let reporter = Address::generate(&env);
        client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
        client.update_price(&reporter, &i, &price).unwrap();
    }
    let agg = client.get_aggregated_price().unwrap();
    // 50M is >10% away from median (≈10.5M), so only 2 sources contribute
    assert_eq!(agg.num_sources, 2);
}

// ── WeightedAverage strategy ──────────────────────────────────────────────────

#[test]
fn test_weighted_average_strategy() {
    let (env, admin, client) = setup();
    client
        .initialize(
            &admin,
            &asset(&env),
            &None,
            &None,
            &None,
            &None,
            &Some(AggregationStrategy::WeightedAverage),
        )
        .unwrap();
    let r0 = Address::generate(&env);
    let r1 = Address::generate(&env);
    client.add_source(&admin, &r0, &desc(&env), &Some(1)).unwrap(); // weight 1
    client.add_source(&admin, &r1, &desc(&env), &Some(3)).unwrap(); // weight 3
    client.update_price(&r0, &0, &1_000_000_0).unwrap();
    client.update_price(&r1, &1, &2_000_000_0).unwrap();
    let agg = client.get_aggregated_price().unwrap();
    // (10M*1 + 20M*3) / 4 = 17_500_000
    assert_eq!(agg.price, (1_000_000_0 + 2_000_000_0 * 3) / 4);
}

// ── TrimmedMean strategy ──────────────────────────────────────────────────────

#[test]
fn test_trimmed_mean_strategy() {
    let (env, admin, client) = setup();
    client
        .initialize(
            &admin,
            &asset(&env),
            &None,
            &None,
            &None,
            &None,
            &Some(AggregationStrategy::TrimmedMean),
        )
        .unwrap();
    let prices = [1_000_000_0i128, 1_100_000_0, 1_200_000_0, 1_300_000_0, 5_000_000_0];
    for (i, &price) in prices.iter().enumerate() {
        let reporter = Address::generate(&env);
        client.add_source(&admin, &reporter, &desc(&env), &None).unwrap();
        client.update_price(&reporter, &(i as u32), &price).unwrap();
    }
    let agg = client.get_aggregated_price().unwrap();
    // trim 10% of 5 = 0 trimmed each side; effectively a plain average of all 5
    // With trim_pct=10 and 5 elements: trim = 5*10/100 = 0, so average of all
    let expected = prices.iter().sum::<i128>() / prices.len() as i128;
    assert_eq!(agg.price, expected);
}

// ── set_strategy / config setters ────────────────────────────────────────────

#[test]
fn test_set_strategy() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    client
        .set_strategy(&admin, &AggregationStrategy::WeightedAverage)
        .unwrap();
    // verify indirectly: add two differently weighted sources
    let r0 = Address::generate(&env);
    let r1 = Address::generate(&env);
    client.add_source(&admin, &r0, &desc(&env), &Some(1)).unwrap();
    client.add_source(&admin, &r1, &desc(&env), &Some(9)).unwrap();
    client.update_price(&r0, &0, &1_000_000_0).unwrap();
    client.update_price(&r1, &1, &2_000_000_0).unwrap();
    let agg = client.get_aggregated_price().unwrap();
    assert_eq!(agg.price, (1_000_000_0 + 2_000_000_0 * 9) / 10);
}

#[test]
fn test_set_max_price_age_invalid() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    assert_eq!(
        client.set_max_price_age(&admin, &0),
        Err(Error::InvalidParameter)
    );
}

#[test]
fn test_set_outlier_bps_invalid() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    assert_eq!(
        client.set_outlier_bps(&admin, &0),
        Err(Error::InvalidParameter)
    );
    assert_eq!(
        client.set_outlier_bps(&admin, &10_001),
        Err(Error::InvalidParameter)
    );
}

#[test]
fn test_set_circuit_breaker_bps_invalid() {
    let (env, admin, client) = setup();
    init(&env, &admin, &client);
    assert_eq!(
        client.set_circuit_breaker_bps(&admin, &0),
        Err(Error::InvalidParameter)
    );
}
