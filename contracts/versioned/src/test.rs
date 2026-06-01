// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{VersionedContract, VersionedContractClient};
use crate::types::Error;

fn setup() -> (Env, Address, VersionedContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, VersionedContract);
    let client = VersionedContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "stable")).unwrap();
    let ver = client.get_version().unwrap();
    assert_eq!(ver.major, 1);
    assert_eq!(ver.minor, 0);
    assert_eq!(ver.patch, 0);
    assert_eq!(client.get_current_index().unwrap(), 0);
    assert_eq!(client.get_version_count().unwrap(), 1);
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    assert_eq!(
        client.initialize(&admin, &2, &0, &0, &s(&env, "v2")).unwrap_err(),
        Error::AlreadyInitialized
    );
}

// ── register_version ──────────────────────────────────────────────────────────

#[test]
fn test_register_version_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    let idx = client.register_version(&admin, &1, &1, &0, &s(&env, "v1.1")).unwrap();
    assert_eq!(idx, 1);
    assert_eq!(client.get_version_count().unwrap(), 2);
    let ver = client.get_version_at(&1).unwrap();
    assert_eq!(ver.minor, 1);
}

#[test]
fn test_non_admin_cannot_register() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client.register_version(&other, &2, &0, &0, &s(&env, "v2")).unwrap_err(),
        Error::Unauthorized
    );
}

#[test]
fn test_get_version_at_not_found() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    assert_eq!(client.get_version_at(&99).unwrap_err(), Error::VersionNotFound);
}

// ── migrate_to_version ────────────────────────────────────────────────────────

#[test]
fn test_migrate_to_version_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    client.migrate_to_version(&admin, &1).unwrap();
    assert_eq!(client.get_current_index().unwrap(), 1);
    assert_eq!(client.get_version().unwrap().major, 2);
}

#[test]
fn test_migrate_same_version_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    assert_eq!(
        client.migrate_to_version(&admin, &0).unwrap_err(),
        Error::AlreadyAtVersion
    );
}

#[test]
fn test_migrate_invalid_index_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    assert_eq!(
        client.migrate_to_version(&admin, &99).unwrap_err(),
        Error::VersionNotFound
    );
}

#[test]
fn test_non_admin_cannot_migrate() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client.migrate_to_version(&other, &1).unwrap_err(),
        Error::Unauthorized
    );
}

// ── rollback_to_version ───────────────────────────────────────────────────────

#[test]
fn test_rollback_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    client.migrate_to_version(&admin, &1).unwrap();
    client.rollback_to_version(&admin, &0).unwrap();
    assert_eq!(client.get_current_index().unwrap(), 0);
    assert_eq!(client.get_version().unwrap().major, 1);
}

// ── migration log ─────────────────────────────────────────────────────────────

#[test]
fn test_migration_log_recorded() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    client.migrate_to_version(&admin, &1).unwrap();
    assert_eq!(client.get_migration_count().unwrap(), 1);
    let rec = client.get_migration(&0).unwrap();
    assert_eq!(rec.from_index, 0);
    assert_eq!(rec.to_index, 1);
}

#[test]
fn test_multiple_migrations_logged() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &1, &0, &0, &s(&env, "v1")).unwrap();
    client.register_version(&admin, &2, &0, &0, &s(&env, "v2")).unwrap();
    client.register_version(&admin, &3, &0, &0, &s(&env, "v3")).unwrap();
    client.migrate_to_version(&admin, &1).unwrap();
    client.migrate_to_version(&admin, &2).unwrap();
    assert_eq!(client.get_migration_count().unwrap(), 2);
}

// ── pre-init guards ───────────────────────────────────────────────────────────

#[test]
fn test_get_version_before_init_fails() {
    let (_env, _admin, client) = setup();
    assert_eq!(client.get_version().unwrap_err(), Error::NotInitialized);
}

#[test]
fn test_get_admin_before_init_fails() {
    let (_env, _admin, client) = setup();
    assert_eq!(client.get_admin().unwrap_err(), Error::NotInitialized);
}
