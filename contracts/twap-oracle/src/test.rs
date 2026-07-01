#![cfg(test)]

use super::{types::Error, TwapOracle, TwapOracleClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};

fn setup() -> (Env, TwapOracleClient<'static>, Address, Address, u32) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TwapOracle);
    let client = TwapOracleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let feeder = Address::generate(&env);
    client.initialize(&admin);
    client.set_feeder(&admin, &feeder, &true);
    let asset_id = client.register_asset(&admin, &String::from_str(&env, "BTC"), &3_600u64);
    (env, client, admin, feeder, asset_id)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, _feeder, _asset_id) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, ..) = setup();
    let result = client.try_initialize(&admin);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

// ── Asset registration ────────────────────────────────────────────────────────

#[test]
fn test_register_asset_increments_id() {
    let (env, client, admin, ..) = setup();
    let id2 = client.register_asset(&admin, &String::from_str(&env, "ETH"), &7_200u64);
    assert_eq!(id2, 2);
}

#[test]
fn test_register_asset_empty_symbol_fails() {
    let (env, client, admin, ..) = setup();
    let result = client.try_register_asset(&admin, &String::from_str(&env, ""), &3_600u64);
    assert!(matches!(result, Err(Ok(Error::EmptyAssetId))));
}

#[test]
fn test_get_asset_id_by_symbol() {
    let (env, client, _admin, _feeder, asset_id) = setup();
    let found = client.get_asset_id(&String::from_str(&env, "BTC"));
    assert_eq!(found, asset_id);
}

// ── Feeder management ─────────────────────────────────────────────────────────

#[test]
fn test_set_feeder_registers_correctly() {
    let (env, client, admin, _feeder, _) = setup();
    let new_feeder = Address::generate(&env);
    assert!(!client.is_feeder(&new_feeder));
    client.set_feeder(&admin, &new_feeder, &true);
    assert!(client.is_feeder(&new_feeder));
}

#[test]
fn test_submit_price_unknown_feeder_fails() {
    let (env, client, _admin, _feeder, asset_id) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_submit_price(&stranger, &asset_id, &50_000_000_000i128);
    assert!(matches!(result, Err(Ok(Error::UnknownFeeder))));
}

// ── Price submission ──────────────────────────────────────────────────────────

#[test]
fn test_submit_price_zero_fails() {
    let (_env, client, _admin, feeder, asset_id) = setup();
    let result = client.try_submit_price(&feeder, &asset_id, &0i128);
    assert!(matches!(result, Err(Ok(Error::InvalidPrice))));
}

#[test]
fn test_submit_price_records_observation() {
    let (_env, client, _admin, feeder, asset_id) = setup();
    client.submit_price(&feeder, &asset_id, &50_000_0000000i128);
    let latest = client.get_latest_price(&asset_id);
    assert_eq!(latest, 50_000_0000000i128);
}

#[test]
fn test_submit_price_when_paused_fails() {
    let (_env, client, admin, feeder, asset_id) = setup();
    client.set_paused(&admin, &true);
    let result = client.try_submit_price(&feeder, &asset_id, &1_000_000i128);
    assert!(matches!(result, Err(Ok(Error::OraclePaused))));
}

// ── TWAP computation ──────────────────────────────────────────────────────────

#[test]
fn test_twap_insufficient_observations_fails() {
    let (_env, client, _admin, feeder, asset_id) = setup();
    client.submit_price(&feeder, &asset_id, &100_0000000i128);
    let result = client.try_get_twap(&asset_id, &3_600u64);
    assert!(matches!(result, Err(Ok(Error::InsufficientObservations))));
}

#[test]
fn test_twap_computed_correctly() {
    let (env, client, _admin, feeder, asset_id) = setup();

    // t=0: price = 100
    client.submit_price(&feeder, &asset_id, &100i128);

    // t=100: price = 200 (held for 100 s)
    env.ledger().with_mut(|l| l.timestamp += 100);
    client.submit_price(&feeder, &asset_id, &200i128);

    // t=200: price = 300 (held for another 100 s)
    env.ledger().with_mut(|l| l.timestamp += 100);
    client.submit_price(&feeder, &asset_id, &300i128);

    // TWAP over last 300 s:
    // cumulative at t=200: 0 + 100*100 + 200*100 = 30_000
    // cumulative at t=0:   0
    // TWAP = 30_000 / 200 = 150
    let twap = client.get_twap(&asset_id, &300u64);
    assert_eq!(twap.price, 150);
    assert_eq!(twap.observation_count, 3);
}

#[test]
fn test_twap_no_observations_fails() {
    let (_env, client, admin, ..) = setup();
    let asset2 = client.register_asset(&admin, &String::from_str(&_env, "SOL"), &3_600u64);
    let result = client.try_get_twap(&asset2, &3_600u64);
    assert!(matches!(result, Err(Ok(Error::InsufficientObservations))));
}

#[test]
fn test_deactivate_asset_blocks_price_submission() {
    let (_env, client, admin, feeder, asset_id) = setup();
    client.deactivate_asset(&admin, &asset_id);
    let result = client.try_submit_price(&feeder, &asset_id, &1_000i128);
    assert!(matches!(result, Err(Ok(Error::AssetNotFound))));
}

#[test]
fn test_non_admin_cannot_register_asset() {
    let (env, client, _admin, _feeder, _) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_register_asset(&stranger, &String::from_str(&env, "ADA"), &3_600u64);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}
