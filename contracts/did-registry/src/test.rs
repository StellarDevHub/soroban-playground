#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{DidRegistry, DidRegistryClient};
use crate::types::{CredentialStatus, Error};

fn setup() -> (Env, Address, DidRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, DidRegistry);
    let client = DidRegistryClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, admin, client)
}

fn did(env: &Env, addr: &Address) -> String {
    String::from_str(env, &format!("did:soroban:{}", addr.to_string()))
}

// ── Initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let (_, _, client) = setup();
    assert!(client.is_initialized());
}

#[test]
fn test_double_initialize_fails() {
    let (env, admin, client) = setup();
    assert_eq!(client.try_initialize(&admin), Err(Ok(Error::AlreadyInitialized)));
}

// ── Identity ──────────────────────────────────────────────────────────────────

#[test]
fn test_register_identity() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &42u64);

    let identity = client.get_identity(&user);
    assert_eq!(identity.owner, user);
    assert_eq!(identity.metadata_hash, 42);
    assert_eq!(identity.reputation, 0);
    assert!(identity.active);
}

#[test]
fn test_duplicate_registration_fails() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &1u64);
    let result = client.try_register_identity(&user, &did(&env, &user), &2u64);
    assert_eq!(result, Err(Ok(Error::IdentityAlreadyExists)));
}

#[test]
fn test_update_metadata() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &1u64);
    client.update_metadata(&user, &99u64);
    assert_eq!(client.get_identity(&user).metadata_hash, 99);
}

#[test]
fn test_update_metadata_deactivated_fails() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &1u64);
    client.deactivate_identity(&user);
    let result = client.try_update_metadata(&user, &99u64);
    assert_eq!(result, Err(Ok(Error::IdentityDeactivated)));
}

#[test]
fn test_deactivate_identity() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &1u64);
    client.deactivate_identity(&user);
    assert!(!client.get_identity(&user).active);
}

#[test]
fn test_get_nonexistent_identity_fails() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    assert_eq!(client.try_get_identity(&user), Err(Ok(Error::IdentityNotFound)));
}

// ── Credentials ───────────────────────────────────────────────────────────────

#[test]
fn test_issue_credential() {
    let (env, _, client) = setup();
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);

    client.register_identity(&issuer, &did(&env, &issuer), &1u64);
    client.register_identity(&subject, &did(&env, &subject), &2u64);

    let cred_id = client.issue_credential(&issuer, &subject, &100u64, &200u64, &0u64);
    assert_eq!(cred_id, 1);
    assert_eq!(client.credential_count(), 1);

    let cred = client.get_credential(&cred_id);
    assert_eq!(cred.issuer, issuer);
    assert_eq!(cred.subject, subject);
    assert_eq!(cred.schema_hash, 100);
    assert_eq!(cred.status, CredentialStatus::Active);
}

#[test]
fn test_issue_credential_unregistered_subject_fails() {
    let (env, _, client) = setup();
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);
    client.register_identity(&issuer, &did(&env, &issuer), &1u64);

    let result = client.try_issue_credential(&issuer, &subject, &1u64, &2u64, &0u64);
    assert_eq!(result, Err(Ok(Error::IdentityNotFound)));
}

#[test]
fn test_issue_credential_deactivated_issuer_fails() {
    let (env, _, client) = setup();
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);
    client.register_identity(&issuer, &did(&env, &issuer), &1u64);
    client.register_identity(&subject, &did(&env, &subject), &2u64);
    client.deactivate_identity(&issuer);

    let result = client.try_issue_credential(&issuer, &subject, &1u64, &2u64, &0u64);
    assert_eq!(result, Err(Ok(Error::IdentityDeactivated)));
}

#[test]
fn test_revoke_credential() {
    let (env, _, client) = setup();
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);
    client.register_identity(&issuer, &did(&env, &issuer), &1u64);
    client.register_identity(&subject, &did(&env, &subject), &2u64);

    let cred_id = client.issue_credential(&issuer, &subject, &1u64, &2u64, &0u64);
    client.revoke_credential(&cred_id);
    assert_eq!(client.get_credential(&cred_id).status, CredentialStatus::Revoked);
}

#[test]
fn test_double_revoke_fails() {
    let (env, _, client) = setup();
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);
    client.register_identity(&issuer, &did(&env, &issuer), &1u64);
    client.register_identity(&subject, &did(&env, &subject), &2u64);

    let cred_id = client.issue_credential(&issuer, &subject, &1u64, &2u64, &0u64);
    client.revoke_credential(&cred_id);
    assert_eq!(
        client.try_revoke_credential(&cred_id),
        Err(Ok(Error::CredentialAlreadyRevoked))
    );
}

// ── Reputation ────────────────────────────────────────────────────────────────

#[test]
fn test_adjust_reputation_positive() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &1u64);

    let score = client.adjust_reputation(&user, &10i32);
    assert_eq!(score, 10);
    assert_eq!(client.get_identity(&user).reputation, 10);
}

#[test]
fn test_adjust_reputation_negative() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &1u64);

    client.adjust_reputation(&user, &20i32);
    let score = client.adjust_reputation(&user, &-5i32);
    assert_eq!(score, 15);
}

#[test]
fn test_adjust_reputation_deactivated_fails() {
    let (env, _, client) = setup();
    let user = Address::generate(&env);
    client.register_identity(&user, &did(&env, &user), &1u64);
    client.deactivate_identity(&user);

    assert_eq!(
        client.try_adjust_reputation(&user, &10i32),
        Err(Ok(Error::IdentityDeactivated))
    );
}

#[test]
fn test_multiple_credentials_count() {
    let (env, _, client) = setup();
    let issuer = Address::generate(&env);
    let subject = Address::generate(&env);
    client.register_identity(&issuer, &did(&env, &issuer), &1u64);
    client.register_identity(&subject, &did(&env, &subject), &2u64);

    client.issue_credential(&issuer, &subject, &1u64, &1u64, &0u64);
    client.issue_credential(&issuer, &subject, &2u64, &2u64, &0u64);
    client.issue_credential(&issuer, &subject, &3u64, &3u64, &0u64);
    assert_eq!(client.credential_count(), 3);
}
