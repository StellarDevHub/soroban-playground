#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{vec, Env, IntoVal};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TokenGatedAccess);
    let client = TokenGatedAccessClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    assert_eq!(client.get_admin(), admin);
}

#[test]
#[should_panic(expected = "AlreadyInitialized")]
fn test_initialize_already_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, TokenGatedAccess);
    let client = TokenGatedAccessClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
fn test_set_and_get_rule() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenGatedAccess);
    let client = TokenGatedAccessClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let resource = symbol_short!("res1");
    let token = Address::generate(&env);
    let min_balance = 100;

    client.set_rule(&resource, &token, &min_balance);

    let rule = client.get_rule(&resource);
    assert_eq!(rule.token, token);
    assert_eq!(rule.min_balance, min_balance);
}

#[test]
fn test_check_access() {
    let env = Env::default();
    env.mock_all_auths();

    // Register our contract
    let contract_id = env.register_contract(None, TokenGatedAccess);
    let client = TokenGatedAccessClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Register a mock token
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let token_client = soroban_sdk::token::Client::new(&env, &token_id);
    let token_admin_client = soroban_sdk::token::StellarAssetClient::new(&env, &token_id);

    let user = Address::generate(&env);
    let resource = symbol_short!("vip");
    let min_balance = 500;

    client.set_rule(&resource, &token_id, &min_balance);

    // User has 0 balance, should fail
    assert_eq!(client.check_access(&user, &resource), false);

    // Mint tokens to user
    token_admin_client.mint(&user, &600);
    assert_eq!(token_client.balance(&user), 600);

    // User has 600 balance, should pass
    assert_eq!(client.check_access(&user, &resource), true);

    // Events check
    let last_event = env.events().all().last().unwrap();
    assert_eq!(
        last_event,
        (
            contract_id.clone(),
            (symbol_short!("access"), resource.clone(), user.clone()).into_val(&env),
            true.into_val(&env)
        )
    );
}

#[test]
fn test_pause() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenGatedAccess);
    let client = TokenGatedAccessClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    client.set_pause(&true);

    let user = Address::generate(&env);
    let resource = symbol_short!("res");
    
    // Should panic or return error when paused
    let result = client.try_check_access(&user, &resource);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}
