#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::{Address as _, Events}, Address, Env, String};

#[test]
fn test_carbon_credit_workflow() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let user = Address::generate(&env);

    // Init
    client.init(&admin);

    // Register Issuer
    let name = String::from_str(&env, "EcoCorp");
    client.register_issuer(&issuer, &name);

    let info = client.get_issuer_info(&issuer).unwrap();
    assert_eq!(info.verified, false);

    // Verify Issuer
    client.verify_issuer(&issuer);
    let info = client.get_issuer_info(&issuer).unwrap();
    assert_eq!(info.verified, true);

    // Mint
    client.mint(&issuer, &user, &1000);
    assert_eq!(client.get_balance(&user), 1000);
    assert_eq!(client.total_supply(), 1000);

    // Transfer
    let user2 = Address::generate(&env);
    client.transfer(&user, &user2, &400);
    assert_eq!(client.get_balance(&user), 600);
    assert_eq!(client.get_balance(&user2), 400);

    // Retire
    client.retire(&user, &200);
    assert_eq!(client.get_balance(&user), 400);
    assert_eq!(client.total_supply(), 800);

    // Check events
    let events = env.events().all();
    let last_event = events.last().unwrap();
    assert_eq!(last_event.2, 200i128.into_val(&env));
}

#[test]
#[should_panic(expected = "Issuer not verified")]
fn test_mint_unverified() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, CarbonCreditContract);
    let client = CarbonCreditContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let issuer = Address::generate(&env);
    let user = Address::generate(&env);

    client.init(&admin);
    client.register_issuer(&issuer, &String::from_str(&env, "DirtyCorp"));
    
    // Attempt mint before verification
    client.mint(&issuer, &user, &100);
}
