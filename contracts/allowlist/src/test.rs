#![cfg(test)]
use super::{AllowlistContract, AllowlistContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

#[test]
fn test_allowlist() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AllowlistContract);
    let client = AllowlistContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    // 1. Initialize the contract.
    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);

    // 2. Add user1 to allowlist as admin.
    env.mock_all_auths();
    client.add(&admin, &user1);
    assert!(client.is_allowed(&user1));
    assert!(!client.is_allowed(&user2));

    // 3. Add user2 to allowlist.
    client.add(&admin, &user2);
    assert!(client.is_allowed(&user2));

    // 4. Remove user1 from allowlist.
    client.remove(&admin, &user1);
    assert!(!client.is_allowed(&user1));
    assert!(client.is_allowed(&user2));
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_unauthorized_add() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AllowlistContract);
    let client = AllowlistContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);
    
    env.mock_all_auths();
    client.add(&non_admin, &user); // Should panic
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_already_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, AllowlistContract);
    let client = AllowlistContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);
    client.initialize(&admin); // Should panic
}
