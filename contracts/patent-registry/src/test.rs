// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, PatentRegistryContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, PatentRegistryContract);
    let client = PatentRegistryContractClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn file_active_patent(
    env: &Env,
    client: &PatentRegistryContractClient,
    admin: &Address,
    inventor: &Address,
) -> u32 {
    let id = client.file_patent(
        inventor,
        &String::from_str(env, "Test Patent"),
        &String::from_str(env, "A useful invention"),
        &(env.ledger().timestamp() + 86400 * 365),
    );
    client.activate_patent(admin, &id);
    id
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, admin, client) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (_env, admin, client) = setup();
    assert!(!client.is_paused());
    client.pause(&admin);
    assert!(client.is_paused());
    client.unpause(&admin);
    assert!(!client.is_paused());
}

#[test]
fn test_paused_blocks_file_patent() {
    let (env, admin, client) = setup();
    client.pause(&admin);
    let inventor = Address::generate(&env);
    assert_eq!(
        client.try_file_patent(
            &inventor,
            &String::from_str(&env, "Title"),
            &String::from_str(&env, "Desc"),
            &9999999999,
        ),
        Err(Ok(Error::Paused))
    );
}

// ── Patent filing ─────────────────────────────────────────────────────────────

#[test]
fn test_file_patent_returns_sequential_ids() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let id1 = client.file_patent(
        &inventor,
        &String::from_str(&env, "Patent A"),
        &String::from_str(&env, "Desc A"),
        &9999999999,
    );
    let id2 = client.file_patent(
        &inventor,
        &String::from_str(&env, "Patent B"),
        &String::from_str(&env, "Desc B"),
        &9999999999,
    );
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_patent_count(), 2);
}

#[test]
fn test_file_patent_empty_title_fails() {
    let (env, _admin, client) = setup();
    let inventor = Address::generate(&env);
    assert_eq!(
        client.try_file_patent(
            &inventor,
            &String::from_str(&env, ""),
            &String::from_str(&env, "Desc"),
            &9999999999,
        ),
        Err(Ok(Error::EmptyField))
    );
}

#[test]
fn test_file_patent_status_is_pending() {
    let (env, _admin, client) = setup();
    let inventor = Address::generate(&env);
    let id = client.file_patent(
        &inventor,
        &String::from_str(&env, "Title"),
        &String::from_str(&env, "Desc"),
        &9999999999,
    );
    let patent = client.get_patent(&id);
    assert_eq!(patent.status, PatentStatus::Pending);
    assert_eq!(patent.owner, inventor);
}

// ── Activate / revoke ─────────────────────────────────────────────────────────

#[test]
fn test_activate_patent() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let id = client.file_patent(
        &inventor,
        &String::from_str(&env, "Title"),
        &String::from_str(&env, "Desc"),
        &9999999999,
    );
    client.activate_patent(&admin, &id);
    assert_eq!(client.get_patent(&id).status, PatentStatus::Active);
}

#[test]
fn test_activate_non_pending_fails() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    assert_eq!(
        client.try_activate_patent(&admin, &id),
        Err(Ok(Error::InvalidStatus))
    );
}

#[test]
fn test_revoke_patent() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    client.revoke_patent(&admin, &id);
    assert_eq!(client.get_patent(&id).status, PatentStatus::Revoked);
}

#[test]
fn test_non_admin_cannot_activate() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let id = client.file_patent(
        &inventor,
        &String::from_str(&env, "Title"),
        &String::from_str(&env, "Desc"),
        &9999999999,
    );
    let other = Address::generate(&env);
    assert_eq!(
        client.try_activate_patent(&other, &id),
        Err(Ok(Error::Unauthorized))
    );
    // admin still works
    client.activate_patent(&admin, &id);
}

// ── Transfer ──────────────────────────────────────────────────────────────────

#[test]
fn test_transfer_patent() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    client.transfer_patent(&inventor, &id, &new_owner);
    assert_eq!(client.get_patent(&id).owner, new_owner);
}

#[test]
fn test_transfer_by_non_owner_fails() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let other = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    assert_eq!(
        client.try_transfer_patent(&other, &id, &other),
        Err(Ok(Error::NotOwner))
    );
}

// ── Licensing ─────────────────────────────────────────────────────────────────

#[test]
fn test_grant_license() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let licensee = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    let lic_id = client.grant_license(
        &inventor,
        &id,
        &licensee,
        &LicenseType::NonExclusive,
        &1_000_000,
        &9999999999,
    );
    assert_eq!(lic_id, 1);
    let lic = client.get_license(&lic_id);
    assert_eq!(lic.patent_id, id);
    assert_eq!(lic.licensee, licensee);
    assert_eq!(lic.fee, 1_000_000);
    assert_eq!(client.get_patent(&id).license_count, 1);
}

#[test]
fn test_grant_license_non_owner_fails() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let other = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    assert_eq!(
        client.try_grant_license(
            &other,
            &id,
            &other,
            &LicenseType::Exclusive,
            &0,
            &9999999999,
        ),
        Err(Ok(Error::NotOwner))
    );
}

// ── Disputes ──────────────────────────────────────────────────────────────────

#[test]
fn test_file_and_resolve_dispute() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let claimant = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);

    let d_id = client.file_dispute(
        &claimant,
        &id,
        &String::from_str(&env, "Prior art exists"),
    );
    assert_eq!(d_id, 1);
    assert_eq!(client.get_dispute(&d_id).status, DisputeStatus::Open);

    client.resolve_dispute(
        &admin,
        &d_id,
        &String::from_str(&env, "Dispute rejected, patent valid"),
    );
    assert_eq!(client.get_dispute(&d_id).status, DisputeStatus::Resolved);
}

#[test]
fn test_resolve_dispute_twice_fails() {
    let (env, admin, client) = setup();
    let inventor = Address::generate(&env);
    let claimant = Address::generate(&env);
    let id = file_active_patent(&env, &client, &admin, &inventor);
    let d_id = client.file_dispute(
        &claimant,
        &id,
        &String::from_str(&env, "Reason"),
    );
    client.resolve_dispute(&admin, &d_id, &String::from_str(&env, "Resolved"));
    assert_eq!(
        client.try_resolve_dispute(&admin, &d_id, &String::from_str(&env, "Again")),
        Err(Ok(Error::DisputeAlreadyResolved))
    );
}

#[test]
fn test_file_dispute_on_nonexistent_patent_fails() {
    let (env, _admin, client) = setup();
    let claimant = Address::generate(&env);
    assert_eq!(
        client.try_file_dispute(&claimant, &999, &String::from_str(&env, "Reason")),
        Err(Ok(Error::PatentNotFound))
    );
}
