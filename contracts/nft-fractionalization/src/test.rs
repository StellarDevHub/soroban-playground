#![cfg(test)]

use super::{NftFractionalization, NftFractionalizationClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, Address, NftFractionalizationClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, NftFractionalization);
    let client = NftFractionalizationClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (env, admin, client) = setup();
    let result = client.try_initialize(&admin);
    assert!(result.is_ok());
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let result = client.try_initialize(&admin);
    assert!(result.is_err());
}

#[test]
fn test_vault_count_starts_at_zero() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    assert_eq!(client.get_vault_count(), 0);
}

#[test]
fn test_get_vault_list_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let list = client.get_vault_list();
    assert_eq!(list.len(), 0);
}
