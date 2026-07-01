#![cfg(test)]

use super::{types::Error, TokenContract, TokenContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, TokenContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(
        &admin,
        &7u32,
        &String::from_str(&env, "Stellar Dollar"),
        &String::from_str(&env, "XUSD"),
    );
    (env, client, admin)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_stores_metadata() {
    let (env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.decimals(), 7);
    assert_eq!(client.name(), String::from_str(&env, "Stellar Dollar"));
    assert_eq!(client.symbol(), String::from_str(&env, "XUSD"));
    assert_eq!(client.total_supply(), 0);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin) = setup();
    let result = client.try_initialize(
        &admin,
        &7u32,
        &String::from_str(&_env, "X"),
        &String::from_str(&_env, "X"),
    );
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

#[test]
fn test_initialize_invalid_decimals_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenContract);
    let client = TokenContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let result = client.try_initialize(
        &admin,
        &19u32,
        &String::from_str(&env, "X"),
        &String::from_str(&env, "X"),
    );
    assert!(matches!(result, Err(Ok(Error::InvalidDecimals))));
}

// ── Mint ──────────────────────────────────────────────────────────────────────

#[test]
fn test_mint_increases_balance_and_supply() {
    let (env, client, admin) = setup();
    let user = Address::generate(&env);
    client.mint(&admin, &user, &1_000_000i128);
    assert_eq!(client.balance(&user), 1_000_000);
    assert_eq!(client.total_supply(), 1_000_000);
}

#[test]
fn test_mint_zero_fails() {
    let (env, client, admin) = setup();
    let user = Address::generate(&env);
    let result = client.try_mint(&admin, &user, &0i128);
    assert!(matches!(result, Err(Ok(Error::ZeroAmount))));
}

#[test]
fn test_mint_non_admin_fails() {
    let (env, client, _admin) = setup();
    let attacker = Address::generate(&env);
    let user = Address::generate(&env);
    let result = client.try_mint(&attacker, &user, &1_000i128);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

// ── Transfer ──────────────────────────────────────────────────────────────────

#[test]
fn test_transfer_moves_balance() {
    let (env, client, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.mint(&admin, &alice, &1_000_000i128);
    client.transfer(&alice, &bob, &400_000i128);
    assert_eq!(client.balance(&alice), 600_000);
    assert_eq!(client.balance(&bob), 400_000);
}

#[test]
fn test_transfer_insufficient_balance_fails() {
    let (env, client, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.mint(&admin, &alice, &100i128);
    let result = client.try_transfer(&alice, &bob, &200i128);
    assert!(matches!(result, Err(Ok(Error::InsufficientBalance))));
}

// ── Approve & transfer_from ───────────────────────────────────────────────────

#[test]
fn test_approve_and_transfer_from() {
    let (env, client, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    client.mint(&admin, &alice, &1_000_000i128);
    client.approve(&alice, &bob, &500_000i128, &(env.ledger().sequence() + 100));
    assert_eq!(client.allowance(&alice, &bob), 500_000);
    client.transfer_from(&bob, &alice, &carol, &300_000i128);
    assert_eq!(client.balance(&alice), 700_000);
    assert_eq!(client.balance(&carol), 300_000);
    assert_eq!(client.allowance(&alice, &bob), 200_000);
}

#[test]
fn test_transfer_from_exceeds_allowance_fails() {
    let (env, client, admin) = setup();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.mint(&admin, &alice, &1_000_000i128);
    client.approve(&alice, &bob, &100i128, &(env.ledger().sequence() + 100));
    let result = client.try_transfer_from(&bob, &alice, &bob, &500i128);
    assert!(matches!(result, Err(Ok(Error::InsufficientAllowance))));
}

// ── Burn ──────────────────────────────────────────────────────────────────────

#[test]
fn test_burn_reduces_balance_and_supply() {
    let (env, client, admin) = setup();
    let alice = Address::generate(&env);
    client.mint(&admin, &alice, &1_000_000i128);
    client.burn(&alice, &300_000i128);
    assert_eq!(client.balance(&alice), 700_000);
    assert_eq!(client.total_supply(), 700_000);
}

#[test]
fn test_burn_insufficient_balance_fails() {
    let (env, client, admin) = setup();
    let alice = Address::generate(&env);
    client.mint(&admin, &alice, &100i128);
    let result = client.try_burn(&alice, &500i128);
    assert!(matches!(result, Err(Ok(Error::InsufficientBalance))));
}

// ── Admin rotation ────────────────────────────────────────────────────────────

#[test]
fn test_set_admin_transfers_control() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);
    client.set_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
    let user = Address::generate(&env);
    client.mint(&new_admin, &user, &1_000i128);
    assert_eq!(client.balance(&user), 1_000);
}
