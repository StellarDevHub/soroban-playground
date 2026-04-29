#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup() -> (Env, Address, TokenGatedAccessClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenGatedAccess);
    let client = TokenGatedAccessClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

#[test]
fn test_initialize() {
    let (_, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
    assert_eq!(client.total_members(), 0);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize() {
    let (env, admin, client) = setup();
    let _ = env;
    client.initialize(&admin);
}

#[test]
fn test_mint_and_access() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://QmTest");

    let token_id = client.mint(&admin, &user, &Tier::Silver, &uri);
    assert_eq!(token_id, 1);
    assert_eq!(client.total_members(), 1);

    // Silver can access Bronze and Silver gates
    assert!(client.check_access(&user, &Tier::Bronze));
    assert!(client.check_access(&user, &Tier::Silver));
    // Silver cannot access Gold gate
    assert!(!client.check_access(&user, &Tier::Gold));
}

#[test]
fn test_revoke() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://QmTest");

    client.mint(&admin, &user, &Tier::Bronze, &uri);
    assert_eq!(client.total_members(), 1);

    client.revoke(&admin, &user);
    assert_eq!(client.total_members(), 0);
    assert!(client.get_token_id(&user).is_none());
}

#[test]
#[should_panic(expected = "already has membership")]
fn test_double_mint() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://QmTest");
    client.mint(&admin, &user, &Tier::Bronze, &uri);
    client.mint(&admin, &user, &Tier::Gold, &uri);
}

#[test]
fn test_pause_unpause() {
    let (_, admin, client) = setup();
    client.pause(&admin);
    assert!(client.is_paused());
    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[test]
#[should_panic(expected = "contract paused")]
fn test_mint_while_paused() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://QmTest");
    client.pause(&admin);
    client.mint(&admin, &user, &Tier::Bronze, &uri);
}

#[test]
fn test_stats_tracking() {
    let (env, admin, client) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://QmTest");
    client.mint(&admin, &user, &Tier::Gold, &uri);

    client.check_access(&user, &Tier::Gold);
    client.check_access(&user, &Tier::Gold);

    let stats = client.get_stats(&user).unwrap();
    assert_eq!(stats.access_count, 2);
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_unauthorized_mint() {
    let (env, _, client) = setup();
    let attacker = Address::generate(&env);
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://QmTest");
    client.mint(&attacker, &user, &Tier::Gold, &uri);
}
