#![cfg(test)]
use super::{AdminSetterContract, AdminSetterContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_admin_setter() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminSetterContract);
    let client = AdminSetterContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    // 1. Initialize the contract.
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);

    // 2. Set value as admin (should succeed).
    // Note: require_auth is automatically handled in tests when calling through the client
    // if we use env.mock_all_auths().
    env.mock_all_auths();
    client.set_value(&admin, &42);
    assert_eq!(client.get_value(), 42);

    // 3. Set value as non-admin (should fail).
    // We expect a panic here because the address doesn't match the current admin.
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_unauthorized_setter() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminSetterContract);
    let client = AdminSetterContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    client.initialize(&admin);
    
    env.mock_all_auths();
    client.set_value(&non_admin, &10); // Should panic
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_already_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AdminSetterContract);
    let client = AdminSetterContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}
