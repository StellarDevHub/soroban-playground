#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

#[test]
fn test_register_and_purchase() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let artist = Address::generate(&env);
    let buyer = Address::generate(&env);

    client.init(&admin);

    let title = String::from_str(&env, "Midnight Drive");
    let price: u128 = 50_000_000; // 50 USDC with 7 decimals

    let track_id = client.register_track(&artist, &title, &price);
    assert_eq!(track_id, 1);

    let track = client.get_track(&track_id);
    assert_eq!(track.artist, artist);
    assert_eq!(track.price, price);
    assert_eq!(track.is_active, true);

    // Purchase License
    client.purchase_license(&buyer, &track_id);

    // Since we don't have a get_licenses yet, the test passing implies no panic occurred.
    // In a full implementation, we'd query the license list to verify.
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, MusicLicensingContract);
    let client = MusicLicensingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let artist = Address::generate(&env);

    client.init(&admin);
    client.pause(&admin);

    let title = String::from_str(&env, "Midnight Drive");
    let price: u128 = 50_000_000;

    // This should panic
    client.register_track(&artist, &title, &price);
}
