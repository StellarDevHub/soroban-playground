#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{Error, ReentrancyGuardContract, ReentrancyGuardContractClient};

fn setup() -> (Env, ReentrancyGuardContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ReentrancyGuardContract);
    let client = ReentrancyGuardContractClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn test_guarded_action_succeeds() {
    let (_, client) = setup();
    client.initialize();
    assert_eq!(client.guarded_action(), Ok(42));
}

#[test]
fn test_reentrancy_is_blocked() {
    let (_, client) = setup();
    client.initialize();
    assert_eq!(client.reentrant_call(), Err(Ok(Error::ReentrantCall)));
}
