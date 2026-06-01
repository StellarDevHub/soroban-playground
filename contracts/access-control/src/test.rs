// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{AccessControl, AccessControlClient, Error};
use crate::types::Role;

fn setup() -> (Env, Address, AccessControlClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, AccessControl);
    let client = AccessControlClient::new(&env, &id);
    let owner = Address::generate(&env);
    (env, owner, client)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    assert_eq!(client.get_owner(), owner);
    assert!(client.has_role(&owner, &(Role::Admin as u32)));
    assert!(client.is_initialized());
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    assert_eq!(
        client.try_initialize(&owner).unwrap_err().unwrap(),
        Error::AlreadyInitialized
    );
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_owner_can_pause() {
    let (_env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    client.try_pause(&owner).unwrap();
    assert!(client.is_paused());
    client.try_unpause(&owner).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_pauser_role_can_pause() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let pauser = Address::generate(&env);
    client.try_grant_role(&owner, &pauser, &(Role::Pauser as u32)).unwrap();
    client.try_pause(&pauser).unwrap();
    assert!(client.is_paused());
}

#[test]
fn test_non_pauser_cannot_pause() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let rando = Address::generate(&env);
    assert_eq!(
        client.try_pause(&rando).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

// ── grant / revoke role ───────────────────────────────────────────────────────

#[test]
fn test_grant_role_ok() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let minter = Address::generate(&env);
    assert!(!client.has_role(&minter, &(Role::Minter as u32)));
    client.try_grant_role(&owner, &minter, &(Role::Minter as u32)).unwrap();
    assert!(client.has_role(&minter, &(Role::Minter as u32)));
}

#[test]
fn test_grant_role_twice_fails() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let minter = Address::generate(&env);
    client.try_grant_role(&owner, &minter, &(Role::Minter as u32)).unwrap();
    assert_eq!(
        client.try_grant_role(&owner, &minter, &(Role::Minter as u32)).unwrap_err().unwrap(),
        Error::RoleAlreadyGranted
    );
}

#[test]
fn test_revoke_role_ok() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let minter = Address::generate(&env);
    client.try_grant_role(&owner, &minter, &(Role::Minter as u32)).unwrap();
    client.try_revoke_role(&owner, &minter, &(Role::Minter as u32)).unwrap();
    assert!(!client.has_role(&minter, &(Role::Minter as u32)));
}

#[test]
fn test_revoke_ungranted_role_fails() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let rando = Address::generate(&env);
    assert_eq!(
        client.try_revoke_role(&owner, &rando, &(Role::Minter as u32)).unwrap_err().unwrap(),
        Error::RoleNotHeld
    );
}

#[test]
fn test_non_admin_cannot_grant_role() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let rando = Address::generate(&env);
    let victim = Address::generate(&env);
    assert_eq!(
        client.try_grant_role(&rando, &victim, &(Role::Minter as u32)).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

#[test]
fn test_grant_blocked_when_paused() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    client.try_pause(&owner).unwrap();
    let minter = Address::generate(&env);
    assert_eq!(
        client.try_grant_role(&owner, &minter, &(Role::Minter as u32)).unwrap_err().unwrap(),
        Error::ContractPaused
    );
}

// ── admin role can grant ───────────────────────────────────────────────────────

#[test]
fn test_admin_role_holder_can_grant() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let admin2 = Address::generate(&env);
    // Grant Admin role to admin2
    client.try_grant_role(&owner, &admin2, &(Role::Admin as u32)).unwrap();
    // admin2 should now be able to grant minter
    let minter = Address::generate(&env);
    client.try_grant_role(&admin2, &minter, &(Role::Minter as u32)).unwrap();
    assert!(client.has_role(&minter, &(Role::Minter as u32)));
}

// ── transfer_ownership ────────────────────────────────────────────────────────

#[test]
fn test_transfer_ownership_ok() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let new_owner = Address::generate(&env);
    client.try_transfer_ownership(&owner, &new_owner).unwrap();
    assert_eq!(client.get_owner(), new_owner);
    assert!(!client.has_role(&owner, &(Role::Admin as u32)));
    assert!(client.has_role(&new_owner, &(Role::Admin as u32)));
}

#[test]
fn test_non_owner_cannot_transfer_ownership() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let rando = Address::generate(&env);
    let new_owner = Address::generate(&env);
    assert_eq!(
        client.try_transfer_ownership(&rando, &new_owner).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

// ── pre-init guards ───────────────────────────────────────────────────────────

#[test]
fn test_pause_before_init_fails() {
    let (env, _owner, client) = setup();
    let caller = Address::generate(&env);
    assert_eq!(
        client.try_pause(&caller).unwrap_err().unwrap(),
        Error::NotInitialized
    );
}

#[test]
fn test_grant_before_init_fails() {
    let (env, _owner, client) = setup();
    let caller = Address::generate(&env);
    let grantee = Address::generate(&env);
    assert_eq!(
        client.try_grant_role(&caller, &grantee, &0).unwrap_err().unwrap(),
        Error::NotInitialized
    );
}

// ── custom role (arbitrary u32) ───────────────────────────────────────────────

#[test]
fn test_custom_role_grant_revoke() {
    let (env, owner, client) = setup();
    client.try_initialize(&owner).unwrap();
    let user = Address::generate(&env);
    let custom_role: u32 = 99;
    client.try_grant_role(&owner, &user, &custom_role).unwrap();
    assert!(client.has_role(&user, &custom_role));
    client.try_revoke_role(&owner, &user, &custom_role).unwrap();
    assert!(!client.has_role(&user, &custom_role));
}
