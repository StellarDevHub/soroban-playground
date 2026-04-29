#![cfg(test)]

use super::{types::Error, VotingContract, VotingContractClient};
use soroban_sdk::{symbol_short, testutils::Address as _, vec, Address, Env, Symbol, Vec};

fn setup() -> (Env, VotingContractClient<'static>, Address, Vec<Symbol>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, VotingContract);
    let client = VotingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let options = vec![
        &env,
        symbol_short!("RUST"),
        symbol_short!("GO"),
        symbol_short!("JS"),
    ];

    (env, client, admin, options)
}

#[test]
fn test_initialize_sets_admin_and_options() {
    let (_env, client, admin, options) = setup();

    client.initialize(&admin, &options);

    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_options(), options);
    assert_eq!(client.total_voters(), 0);
}

#[test]
fn test_initialize_rejects_duplicate_options() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, VotingContract);
    let client = VotingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let options = vec![&env, symbol_short!("RUST"), symbol_short!("RUST")];

    let result = client.try_initialize(&admin, &options);
    assert!(matches!(result, Err(Ok(Error::DuplicateOption))));
}

#[test]
fn test_initialize_cannot_run_twice() {
    let (_env, client, admin, options) = setup();

    client.initialize(&admin, &options);

    let result = client.try_initialize(&admin, &options);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

#[test]
fn test_vote_records_first_vote() {
    let (env, client, admin, options) = setup();
    client.initialize(&admin, &options);

    let voter = Address::generate(&env);
    let rust = symbol_short!("RUST");

    client.vote(&voter, &rust);

    assert_eq!(client.get_vote(&voter), Some(rust.clone()));
    assert!(client.has_voted(&voter));
    assert_eq!(client.get_votes(&rust), 1);
    assert_eq!(client.total_voters(), 1);
}

#[test]
fn test_vote_can_move_between_options() {
    let (env, client, admin, options) = setup();
    client.initialize(&admin, &options);

    let voter = Address::generate(&env);
    let rust = symbol_short!("RUST");
    let go = symbol_short!("GO");

    client.vote(&voter, &rust);
    client.vote(&voter, &go);

    assert_eq!(client.get_vote(&voter), Some(go.clone()));
    assert_eq!(client.get_votes(&rust), 0);
    assert_eq!(client.get_votes(&go), 1);
    assert_eq!(client.total_voters(), 1);
}

#[test]
fn test_vote_rejects_unknown_option() {
    let (env, client, admin, options) = setup();
    client.initialize(&admin, &options);

    let voter = Address::generate(&env);
    let unknown = symbol_short!("PY");

    let result = client.try_vote(&voter, &unknown);
    assert!(matches!(result, Err(Ok(Error::UnknownOption))));
}

#[test]
fn test_repeated_vote_for_same_option_is_noop() {
    let (env, client, admin, options) = setup();
    client.initialize(&admin, &options);

    let voter = Address::generate(&env);
    let rust = symbol_short!("RUST");

    client.vote(&voter, &rust);
    client.vote(&voter, &rust);

    assert_eq!(client.get_vote(&voter), Some(rust.clone()));
    assert_eq!(client.get_votes(&rust), 1);
    assert_eq!(client.total_voters(), 1);
}

#[test]
fn test_read_methods_fail_before_initialization() {
    let env = Env::default();
    let contract_id = env.register_contract(None, VotingContract);
    let client = VotingContractClient::new(&env, &contract_id);
    let voter = Address::generate(&env);
    let option = symbol_short!("RUST");

    assert!(!client.is_initialized());

    let vote_result = client.try_get_vote(&voter);
    assert!(matches!(vote_result, Err(Ok(Error::NotInitialized))));

    let count_result = client.try_get_votes(&option);
    assert!(matches!(count_result, Err(Ok(Error::NotInitialized))));
}

#[test]
fn test_registered_option_queries_work() {
    let (_env, client, admin, options) = setup();
    client.initialize(&admin, &options);

    let rust = symbol_short!("RUST");
    let python = symbol_short!("PY");

    assert!(client.is_option_registered(&rust));
    assert!(!client.is_option_registered(&python));
}
