// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{TokenGatedAccess, TokenGatedAccessClient};
use crate::types::{Error, Tier};

fn setup() -> (Env, TokenGatedAccessClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TokenGatedAccess);
    let client = TokenGatedAccessClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn test_initialize_once() {
    let (_, client, admin) = setup();
    assert_eq!(client.initialize(&admin), Err(Error::AlreadyInitialized));
}

#[test]
fn test_mint_and_check_access() {
    let (env, client, admin) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://membership/1");

    let token_id = client.mint(&admin, &user, &Tier::Premium, &0u64, &uri).unwrap();
    assert_eq!(token_id, 1);

    // Premium user passes Basic check
    assert!(client.check_access(&user, &Tier::Basic).unwrap());
    // Premium user passes Premium check
    assert!(client.check_access(&user, &Tier::Premium).unwrap());
    // Premium user fails Elite check
    assert!(!client.check_access(&user, &Tier::Elite).unwrap());
}

#[test]
fn test_no_membership_denied() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    assert!(!client.check_access(&stranger, &Tier::Basic).unwrap());
}

#[test]
fn test_revoke() {
    let (env, client, admin) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://membership/2");
    let token_id = client.mint(&admin, &user, &Tier::Basic, &0u64, &uri).unwrap();

    client.revoke(&admin, &token_id);
    assert!(!client.check_access(&user, &Tier::Basic).unwrap());

    let stats = client.get_analytics();
    assert_eq!(stats.total_members, 0);
}

#[test]
fn test_upgrade() {
    let (env, client, admin) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://membership/3");
    let token_id = client.mint(&admin, &user, &Tier::Basic, &0u64, &uri).unwrap();

    client.upgrade(&admin, &token_id, &Tier::Elite);
    assert!(client.check_access(&user, &Tier::Elite).unwrap());

    let stats = client.get_analytics();
    assert_eq!(stats.elite_count, 1);
    assert_eq!(stats.basic_count, 0);
}

#[test]
fn test_duplicate_mint_rejected() {
    let (env, client, admin) = setup();
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://membership/4");
    client.mint(&admin, &user, &Tier::Basic, &0u64, &uri).unwrap();
    assert_eq!(
        client.mint(&admin, &user, &Tier::Premium, &0u64, &uri),
        Err(Error::AlreadyMember)
    );
}

#[test]
fn test_pause_blocks_mint() {
    let (env, client, admin) = setup();
    client.pause(&admin);
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://membership/5");
    assert_eq!(
        client.mint(&admin, &user, &Tier::Basic, &0u64, &uri),
        Err(Error::Paused)
    );
    client.unpause(&admin);
    client.mint(&admin, &user, &Tier::Basic, &0u64, &uri).unwrap();
}

#[test]
fn test_analytics() {
    let (env, client, admin) = setup();
    let u1 = Address::generate(&env);
    let u2 = Address::generate(&env);
    let u3 = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://x");

    client.mint(&admin, &u1, &Tier::Basic, &0u64, &uri).unwrap();
    client.mint(&admin, &u2, &Tier::Premium, &0u64, &uri).unwrap();
    client.mint(&admin, &u3, &Tier::Elite, &0u64, &uri).unwrap();

    client.check_access(&u1, &Tier::Basic).unwrap();
    client.check_access(&u2, &Tier::Basic).unwrap();

    let stats = client.get_analytics();
    assert_eq!(stats.total_members, 3);
    assert_eq!(stats.basic_count, 1);
    assert_eq!(stats.premium_count, 1);
    assert_eq!(stats.elite_count, 1);
    assert_eq!(stats.total_access_checks, 2);
}

#[test]
fn test_unauthorized_mint_rejected() {
    let (env, client, _admin) = setup();
    let attacker = Address::generate(&env);
    let user = Address::generate(&env);
    let uri = String::from_str(&env, "ipfs://x");
    assert_eq!(
        client.mint(&attacker, &user, &Tier::Basic, &0u64, &uri),
        Err(Error::Unauthorized)
    );
}
