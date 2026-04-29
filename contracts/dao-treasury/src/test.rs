#![cfg(test)]

use super::*;
use crate::types::{Error, Role, TxStatus};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

#[test]
fn test_initialize() {
    let env = Env::default();
    let contract_id = env.register_contract(None, DaoTreasury);
    let client = DaoTreasuryClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.initialize(&owner, &2);

    // Initial state checks could be added here if we expose getters, but we haven't exposed getters in lib.rs yet.
    // Assuming successful initialization.
}

#[test]
fn test_propose_and_approve() {
    let env = Env::default();
    let contract_id = env.register_contract(None, DaoTreasury);
    let client = DaoTreasuryClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&owner, &1);

    let proposer = owner.clone();
    let description = String::from_str(&env, "Test Proposal");
    let amount = 1000;
    let recipient = Address::generate(&env);

    let tx_id = client.propose(&proposer, &description, &amount, &Some(recipient.clone()));
    assert_eq!(tx_id, 0);

    client.approve(&owner, &tx_id);
    // Since threshold is 1, it should be queued now.
}

#[test]
#[should_panic(expected = "HostError: Error(Contract, #13)")]
fn test_pause_prevents_propose() {
    let env = Env::default();
    let contract_id = env.register_contract(None, DaoTreasury);
    let client = DaoTreasuryClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    env.mock_all_auths();
    client.initialize(&owner, &1);

    client.pause(&owner);

    let description = String::from_str(&env, "Test Proposal");
    let recipient = Address::generate(&env);
    client.propose(&owner, &description, &1000, &Some(recipient));
}
