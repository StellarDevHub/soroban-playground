#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{Oracle, OracleClient};

fn setup() -> (Env, OracleClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, Oracle);
    let client = OracleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None, &None);
    (env, client, admin)
}

#[test]
fn test_initialize_once() {
    let (_, client, admin) = setup();
    let res = client.try_initialize(&admin, &None, &None);
    assert!(res.is_err());
}

#[test]
fn test_submit_and_get_price() {
    let (env, client, admin) = setup();
    let reporter = Address::generate(&env);
    client.add_reporter(&admin, &reporter);
    client.submit_price(&reporter, &1_000_000_i128);
    let agg = client.get_price();
    assert_eq!(agg.price, 1_000_000);
    assert_eq!(agg.num_sources, 1);
}

#[test]
fn test_stale_price_excluded() {
    let (env, client, admin) = setup();
    let reporter = Address::generate(&env);
    client.add_reporter(&admin, &reporter);
    // Set a very tight staleness window.
    client.set_max_age(&admin, &1_u64);
    client.submit_price(&reporter, &1_000_000_i128);
    // Advance ledger time past the staleness window.
    env.ledger().set_timestamp(env.ledger().timestamp() + 10);
    let res = client.try_get_price();
    assert!(res.is_err());
}

#[test]
fn test_median_of_multiple_sources() {
    let (env, client, admin) = setup();
    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);
    client.add_reporter(&admin, &r1);
    client.add_reporter(&admin, &r2);
    client.add_reporter(&admin, &r3);
    client.submit_price(&r1, &100_i128);
    client.submit_price(&r2, &200_i128);
    client.submit_price(&r3, &300_i128);
    let agg = client.get_price();
    assert_eq!(agg.price, 200); // median of [100, 200, 300]
    assert_eq!(agg.num_sources, 3);
}

#[test]
fn test_min_sources_enforcement() {
    let (env, client, admin) = setup();
    // Require 2 sources but only register 1.
    client.set_min_sources(&admin, &2_u32);
    let reporter = Address::generate(&env);
    client.add_reporter(&admin, &reporter);
    client.submit_price(&reporter, &1_000_i128);
    let res = client.try_get_price();
    assert!(res.is_err());
}

#[test]
fn test_pause_blocks_price_submission_and_read() {
    let (env, client, admin) = setup();
    let reporter = Address::generate(&env);
    client.add_reporter(&admin, &reporter);
    client.pause(&admin);
    assert!(client.try_submit_price(&reporter, &100_i128).is_err());
    assert!(client.try_get_price().is_err());
    client.unpause(&admin);
    client.submit_price(&reporter, &100_i128);
    assert!(client.get_price().price > 0);
}

#[test]
fn test_unauthorized_reporter_rejected() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    let res = client.try_submit_price(&stranger, &1_000_i128);
    assert!(res.is_err());
}

#[test]
fn test_invalid_price_rejected() {
    let (env, client, admin) = setup();
    let reporter = Address::generate(&env);
    client.add_reporter(&admin, &reporter);
    assert!(client.try_submit_price(&reporter, &0_i128).is_err());
    assert!(client.try_submit_price(&reporter, &-1_i128).is_err());
}
