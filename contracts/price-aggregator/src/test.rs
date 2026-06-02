#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, Symbol};

fn setup() -> (Env, Address, PriceAggregatorContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PriceAggregatorContract);
    let client = PriceAggregatorContractClient::new(&env, &contract_id);
    (env, Address::random(&env), client)
}

fn add_sources(client: &PriceAggregatorContractClient<'_>, admin: &Address, sources: &[Address], weights: &[u32]) {
    for (source, weight) in sources.iter().zip(weights.iter()) {
        client.add_source(admin, source.clone(), *weight).unwrap();
    }
}

#[test]
fn test_initialize_and_source_management() {
    let (env, admin, client) = setup();
    let source = Address::random(&env);

    client
        .initialize(admin.clone(), AggregationStrategy::Median, 2, 2000, 3000)
        .unwrap();
    client.add_source(admin.clone(), source.clone(), 10).unwrap();

    let price_err = client.get_price(Symbol::new(&env, "BTC"));
    assert_eq!(price_err, Err(AggregatorError::NotEnoughSources));

    client.set_weight(admin.clone(), source.clone(), 20).unwrap();
    client.remove_source(admin.clone(), source.clone()).unwrap();
    assert_eq!(client.remove_source(admin.clone(), source.clone()), Err(AggregatorError::SourceNotFound));
}

#[test]
fn test_update_price_and_median_aggregation() {
    let (env, admin, client) = setup();
    let sources = vec![
        Address::random(&env),
        Address::random(&env),
        Address::random(&env),
        Address::random(&env),
    ];
    client.initialize(admin.clone(), AggregationStrategy::Median, 2, 2000, 5000).unwrap();
    add_sources(&client, &admin, &sources[1..], &[10, 10, 10]);

    client.update_price(sources[1].clone(), Symbol::new(&env, "USD"), 100).unwrap();
    client.update_price(sources[2].clone(), Symbol::new(&env, "USD"), 110).unwrap();
    client.update_price(sources[3].clone(), Symbol::new(&env, "USD"), 130).unwrap();

    let price = client.get_price(Symbol::new(&env, "USD")).unwrap();
    assert_eq!(price, 110);
}

#[test]
fn test_weighted_average_aggregation() {
    let (env, admin, client) = setup();
    let a = Address::random(&env);
    let b = Address::random(&env);
    let c = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::WeightedAverage, 2, 2000, 5000).unwrap();
    add_sources(&client, &admin, &[a.clone(), b.clone(), c.clone()], &[1, 2, 3]);

    client.update_price(a.clone(), Symbol::new(&env, "USD"), 100).unwrap();
    client.update_price(b.clone(), Symbol::new(&env, "USD"), 110).unwrap();
    client.update_price(c.clone(), Symbol::new(&env, "USD"), 130).unwrap();

    let price = client.get_price(Symbol::new(&env, "USD")).unwrap();
    assert_eq!(price, 120);
}

#[test]
fn test_trimmed_mean_aggregation() {
    let (env, admin, client) = setup();
    let a = Address::random(&env);
    let b = Address::random(&env);
    let c = Address::random(&env);
    let d = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::TrimmedMean, 3, 2000, 5000).unwrap();
    add_sources(&client, &admin, &[a.clone(), b.clone(), c.clone(), d.clone()], &[1, 1, 1, 1]);

    client.update_price(a.clone(), Symbol::new(&env, "USD"), 100).unwrap();
    client.update_price(b.clone(), Symbol::new(&env, "USD"), 110).unwrap();
    client.update_price(c.clone(), Symbol::new(&env, "USD"), 120).unwrap();
    client.update_price(d.clone(), Symbol::new(&env, "USD"), 1000).unwrap();

    let price = client.get_price(Symbol::new(&env, "USD")).unwrap();
    assert_eq!(price, 110);
}

#[test]
fn test_outlier_detection_blocks_bad_update() {
    let (env, admin, client) = setup();
    let a = Address::random(&env);
    let b = Address::random(&env);
    let c = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::Median, 2, 1000, 5000).unwrap();
    add_sources(&client, &admin, &[a.clone(), b.clone(), c.clone()], &[1, 1, 1]);

    client.update_price(a.clone(), Symbol::new(&env, "EUR"), 100).unwrap();
    client.update_price(b.clone(), Symbol::new(&env, "EUR"), 102).unwrap();
    assert_eq!(client.update_price(c.clone(), Symbol::new(&env, "EUR"), 200).unwrap_err(), AggregatorError::OutlierDetected);
}

#[test]
fn test_circuit_breaker_triggers_on_large_reprice() {
    let (env, admin, client) = setup();
    let a = Address::random(&env);
    let b = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::Median, 2, 2000, 2000).unwrap();
    add_sources(&client, &admin, &[a.clone(), b.clone()], &[1, 1]);

    client.update_price(a.clone(), Symbol::new(&env, "BTC"), 100).unwrap();
    client.update_price(b.clone(), Symbol::new(&env, "BTC"), 100).unwrap();
    assert_eq!(client.update_price(a.clone(), Symbol::new(&env, "BTC"), 500).unwrap_err(), AggregatorError::CircuitBreakerTriggered);
}

#[test]
fn test_get_aggregated_price_with_strategy_override() {
    let (env, admin, client) = setup();
    let a = Address::random(&env);
    let b = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::Median, 2, 2000, 5000).unwrap();
    add_sources(&client, &admin, &[a.clone(), b.clone()], &[1, 3]);

    client.update_price(a.clone(), Symbol::new(&env, "USD"), 100).unwrap();
    client.update_price(b.clone(), Symbol::new(&env, "USD"), 120).unwrap();

    let median = client.get_aggregated_price(Symbol::new(&env, "USD"), AggregationStrategy::Median).unwrap();
    let weighted = client.get_aggregated_price(Symbol::new(&env, "USD"), AggregationStrategy::WeightedAverage).unwrap();
    assert_eq!(median, 110);
    assert_eq!(weighted, 116);
}

#[test]
fn test_get_source_price_returns_last_reported_value() {
    let (env, admin, client) = setup();
    let source = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::Median, 1, 2000, 5000).unwrap();
    add_sources(&client, &admin, &[source.clone()], &[1]);
    client.update_price(source.clone(), Symbol::new(&env, "GOLD"), 1800).unwrap();

    let price_data = client.get_source_price(source.clone(), Symbol::new(&env, "GOLD")).unwrap();
    assert_eq!(price_data.price, 1800);
    assert!(price_data.timestamp > 0);
}

#[test]
fn test_update_price_for_unregistered_source_fails() {
    let (env, _admin, client) = setup();
    let source = Address::random(&env);
    client.initialize(Address::random(&env), AggregationStrategy::Median, 1, 2000, 5000).unwrap();
    assert_eq!(client.update_price(source.clone(), Symbol::new(&env, "USD"), 100).unwrap_err(), AggregatorError::SourceNotFound);
}

#[test]
fn test_invalid_weight_rejected() {
    let (env, admin, client) = setup();
    client.initialize(admin.clone(), AggregationStrategy::Median, 1, 2000, 5000).unwrap();
    let source = Address::random(&env);
    assert_eq!(client.add_source(admin.clone(), source.clone(), 0).unwrap_err(), AggregatorError::InvalidWeight);
}

#[test]
fn test_remove_source_not_found() {
    let (env, admin, client) = setup();
    client.initialize(admin.clone(), AggregationStrategy::Median, 1, 2000, 5000).unwrap();
    assert_eq!(client.remove_source(admin.clone(), Address::random(&env)).unwrap_err(), AggregatorError::SourceNotFound);
}

#[test]
fn test_set_weight_for_missing_source() {
    let (env, admin, client) = setup();
    client.initialize(admin.clone(), AggregationStrategy::Median, 1, 2000, 5000).unwrap();
    assert_eq!(client.set_weight(admin.clone(), Address::random(&env), 5).unwrap_err(), AggregatorError::SourceNotFound);
}

#[test]
fn test_not_initialized_errors() {
    let (env, _admin, client) = setup();
    let source = Address::random(&env);
    assert_eq!(client.get_price(Symbol::new(&env, "USD")).unwrap_err(), AggregatorError::NotInitialized);
    assert_eq!(client.add_source(Address::random(&env), source.clone(), 1).unwrap_err(), AggregatorError::NotInitialized);
}

#[test]
fn test_admin_only_operations_require_admin() {
    let (env, admin, client) = setup();
    let source = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::Median, 1, 2000, 5000).unwrap();
    assert_eq!(client.add_source(Address::random(&env), source.clone(), 1).unwrap_err(), AggregatorError::Unauthorized);
}

#[test]
fn test_get_aggregated_price_fails_with_insufficient_prices() {
    let (env, admin, client) = setup();
    let source = Address::random(&env);
    client.initialize(admin.clone(), AggregationStrategy::Median, 2, 2000, 5000).unwrap();
    add_sources(&client, &admin, &[source.clone()], &[1]);
    client.update_price(source.clone(), Symbol::new(&env, "USD"), 100).unwrap();
    assert_eq!(client.get_price(Symbol::new(&env, "USD")).unwrap_err(), AggregatorError::NotEnoughSources);
}
