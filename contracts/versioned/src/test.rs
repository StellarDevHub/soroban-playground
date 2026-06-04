// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{Error, VersionedContract, VersionedContractClient};

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn setup() -> (Env, Address, VersionedContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, VersionedContract);
    let client = VersionedContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    let v = client.get_version();
    assert_eq!(v.major, 1);
    assert_eq!(v.minor, 0);
    assert_eq!(v.patch, 0);
    assert_eq!(client.get_current_index(), 0);
    assert_eq!(client.get_version_count(), 1);
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    assert_eq!(
        client
            .try_initialize(&admin, &2, &0, &0, &s(&env, "v2"))
            .unwrap_err()
            .unwrap(),
        Error::AlreadyInitialized
    );
}

// ── register_version ──────────────────────────────────────────────────────────

#[test]
fn test_register_version_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    let idx = client
        .try_register_version(&admin, &2, &0, &0, &s(&env, "v2"))
        .unwrap()
        .unwrap();
    assert_eq!(idx, 1);
    assert_eq!(client.get_version_count(), 2);
}

#[test]
fn test_non_admin_cannot_register() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client
            .try_register_version(&other, &2, &0, &0, &s(&env, "v2"))
            .unwrap_err()
            .unwrap(),
        Error::Unauthorized
    );
}

// ── migrate_to_version ────────────────────────────────────────────────────────

#[test]
fn test_migrate_to_current_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    assert_eq!(
        client.try_migrate_to_version(&admin, &0).unwrap_err().unwrap(),
        Error::AlreadyAtVersion
    );
}

#[test]
fn test_migrate_to_out_of_range_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    assert_eq!(
        client.try_migrate_to_version(&admin, &99).unwrap_err().unwrap(),
        Error::VersionNotFound
    );
}

#[test]
fn test_non_admin_cannot_migrate() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.try_register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client.try_migrate_to_version(&other, &1).unwrap_err().unwrap(),
        Error::Unauthorized
    );
}

#[test]
fn test_rollback_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.try_register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    client.try_migrate_to_version(&admin, &1).unwrap();
    client.try_rollback_to_version(&admin, &0).unwrap();
    assert_eq!(client.get_current_index(), 0);
    let v = client.get_version();
    assert_eq!(v.major, 1);
}

// ── migration log ─────────────────────────────────────────────────────────────

#[test]
fn test_migration_log_recorded() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.try_register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    client.try_migrate_to_version(&admin, &1).unwrap();
    assert_eq!(client.get_migration_count(), 1);
    let rec = client.get_migration(&0);
    assert_eq!(rec.from_index, 0);
    assert_eq!(rec.to_index, 1);
}

#[test]
fn test_multiple_migrations_logged() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.try_register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    client.try_register_version(&admin, &3, &0, &0, &s(&env, "v3")).unwrap();
    client.try_migrate_to_version(&admin, &1).unwrap();
    client.try_migrate_to_version(&admin, &2).unwrap();
    assert_eq!(client.get_migration_count(), 2);
}

// ── pre-init guards ───────────────────────────────────────────────────────────

#[test]
fn test_get_version_before_init_fails() {
    let (_env, _admin, client) = setup();
    assert_eq!(
        client.try_get_version().unwrap_err().unwrap(),
        Error::NotInitialized
    );
}

#[test]
fn test_get_admin_before_init_fails() {
    let (_env, _admin, client) = setup();
    assert_eq!(
        client.try_get_admin().unwrap_err().unwrap(),
        Error::NotInitialized
    );
}
