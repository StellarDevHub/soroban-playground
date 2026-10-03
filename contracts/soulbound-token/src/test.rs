#![cfg(test)]

use super::{SoulboundToken, SoulboundTokenClient};
use crate::types::{ClaimStatus, Error};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Address, Bytes, BytesN, Env,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Deterministic ed25519 keypair plus its `BytesN<32>` public key.
fn test_keypair(env: &Env, seed_byte: u8) -> (SigningKey, BytesN<32>) {
    let signing = SigningKey::from_bytes(&[seed_byte; 32]);
    let verify_bytes = signing.verifying_key().to_bytes();
    (signing, BytesN::from_array(env, &verify_bytes))
}

/// The exact preimage the contract verifies:
/// `b"SBT1" || pubkey || payload || expiration_be || nonce_be`.
fn signing_message(
    pubkey: &[u8; 32],
    payload: &[u8],
    expiration: u64,
    nonce: u64,
) -> std::vec::Vec<u8> {
    let mut msg = std::vec::Vec::new();
    msg.extend_from_slice(b"SBT1");
    msg.extend_from_slice(pubkey);
    msg.extend_from_slice(payload);
    msg.extend_from_slice(&expiration.to_be_bytes());
    msg.extend_from_slice(&nonce.to_be_bytes());
    msg
}

fn setup() -> (Env, SoulboundTokenClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SoulboundToken);
    let client = SoulboundTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

/// Register an issuer and return its signing key + public key.
fn register_issuer(
    env: &Env,
    client: &SoulboundTokenClient<'static>,
    admin: &Address,
    seed: u8,
) -> (Address, SigningKey, BytesN<32>) {
    let issuer = Address::generate(env);
    let (signing, pubkey) = test_keypair(env, seed);
    client.register_issuer(&admin, &issuer, &pubkey);
    (issuer, signing, pubkey)
}

/// Issue an attestation signed by `signing`.
#[allow(clippy::too_many_arguments)]
fn issue(
    env: &Env,
    client: &SoulboundTokenClient<'static>,
    issuer: &Address,
    signing: &SigningKey,
    pubkey: &BytesN<32>,
    recipient: &Address,
    claim: soroban_sdk::Symbol,
    expiration: u64,
    payload: &[u8],
) -> u32 {
    let nonce = client.issuer_nonce(issuer);
    let msg = signing_message(&pubkey.to_array(), payload, expiration, nonce);
    let sig = signing.sign(&msg);
    client.issue_attestation(
        issuer,
        recipient,
        &claim,
        &expiration,
        &Bytes::from_slice(env, payload),
        &BytesN::from_array(env, &sig.to_bytes()),
    )
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
    assert_eq!(client.attestation_count(), 0);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin) = setup();
    let result = client.try_initialize(&admin);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

#[test]
fn test_register_issuer_requires_admin() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    let issuer = Address::generate(&env);
    let (_signing, pubkey) = test_keypair(&env, 3);
    let result = client.try_register_issuer(&stranger, &issuer, &pubkey);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_register_issuer_twice_fails() {
    let (env, client, admin) = setup();
    let issuer = Address::generate(&env);
    let (_signing, pubkey) = test_keypair(&env, 3);
    client.register_issuer(&admin, &issuer, &pubkey);
    let result = client.try_register_issuer(&admin, &issuer, &pubkey);
    assert!(matches!(result, Err(Ok(Error::IssuerAlreadyRegistered))));
}

// ── Issuance + signature verification ────────────────────────────────────────

#[test]
fn test_issue_attestation_ok() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);

    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        1_000_000,
        b"kyc-proof",
    );

    assert_eq!(id, 1);
    assert_eq!(client.attestation_count(), 1);
    assert_eq!(client.owner_of(&id), recipient);
    assert_eq!(client.balance_of(&recipient), 1);
    assert!(client.is_attestation_valid(&id));
    assert!(client.has_valid_claim(&recipient, &symbol_short!("KYC")));
    assert!(!client.has_valid_claim(&recipient, &symbol_short!("DEV")));

    let attestation = client.get_attestation(&id);
    assert_eq!(attestation.issuer, issuer);
    assert_eq!(attestation.status, ClaimStatus::Active);
    assert_eq!(attestation.expires_at, 1_000_000);
}

#[test]
fn test_issue_increments_issuer_nonce() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);

    assert_eq!(client.issuer_nonce(&issuer), 0);
    issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        1_000_000,
        b"proof-one",
    );
    assert_eq!(client.issuer_nonce(&issuer), 1);
    issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("DEV"),
        1_000_000,
        b"proof-two",
    );
    assert_eq!(client.issuer_nonce(&issuer), 2);
}

#[test]
fn test_issue_replayed_signature_fails() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);

    let msg = signing_message(&pubkey.to_array(), b"replay", 1_000_000, 0);
    let sig = signing.sign(&msg);
    let signature = BytesN::from_array(&env, &sig.to_bytes());
    let payload = Bytes::from_slice(&env, b"replay");

    client.issue_attestation(
        &issuer,
        &recipient,
        &symbol_short!("KYC"),
        &1_000_000,
        &payload,
        &signature,
    );
    // Same signature now embeds nonce 0 but the issuer nonce advanced to 1.
    let result = client.try_issue_attestation(
        &issuer,
        &recipient,
        &symbol_short!("KYC"),
        &1_000_000,
        &payload,
        &signature,
    );
    assert!(result.is_err());
}

#[test]
fn test_issue_unknown_issuer_fails() {
    let (env, client, _admin) = setup();
    let issuer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let (_signing, _pubkey) = test_keypair(&env, 9);
    let result = client.try_issue_attestation(
        &issuer,
        &recipient,
        &symbol_short!("KYC"),
        &1_000_000,
        &Bytes::from_slice(&env, b"x"),
        &BytesN::from_array(&env, &[0u8; 64]),
    );
    assert!(matches!(result, Err(Ok(Error::UnknownIssuer))));
}

#[test]
fn test_issue_empty_payload_fails() {
    let (env, client, admin) = setup();
    let (issuer, _signing, _pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let result = client.try_issue_attestation(
        &issuer,
        &recipient,
        &symbol_short!("KYC"),
        &1_000_000,
        &Bytes::new(&env),
        &BytesN::from_array(&env, &[0u8; 64]),
    );
    assert!(matches!(result, Err(Ok(Error::EmptyPayload))));
}

#[test]
fn test_issue_past_expiration_fails() {
    let (env, client, admin) = setup();
    let (issuer, _signing, _pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    env.ledger().with_mut(|l| l.timestamp = 5_000);
    let result = client.try_issue_attestation(
        &issuer,
        &recipient,
        &symbol_short!("KYC"),
        &100,
        &Bytes::from_slice(&env, b"x"),
        &BytesN::from_array(&env, &[0u8; 64]),
    );
    assert!(matches!(result, Err(Ok(Error::InvalidExpiration))));
}

#[test]
fn test_issue_bad_signature_traps() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    // Sign over a different payload than the one submitted.
    let msg = signing_message(&pubkey.to_array(), b"other", 1_000_000, 0);
    let bad = signing.sign(&msg);
    let result = client.try_issue_attestation(
        &issuer,
        &recipient,
        &symbol_short!("KYC"),
        &1_000_000,
        &Bytes::from_slice(&env, b"submitted"),
        &BytesN::from_array(&env, &bad.to_bytes()),
    );
    assert!(result.is_err());
}

// ── Expiration tracking ───────────────────────────────────────────────────────

#[test]
fn test_expired_attestation_is_invalid() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        1_000,
        b"expiring",
    );

    assert!(client.is_attestation_valid(&id));
    env.ledger().with_mut(|l| l.timestamp = 1_001);
    assert!(!client.is_attestation_valid(&id));
    assert!(!client.has_valid_claim(&recipient, &symbol_short!("KYC")));
}

#[test]
fn test_zero_expiration_never_expires() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("GOV"),
        0,
        b"permanent",
    );
    env.ledger().with_mut(|l| l.timestamp = 10_000_000);
    assert!(client.is_attestation_valid(&id));
}

// ── Revocation ────────────────────────────────────────────────────────────────

#[test]
fn test_issuer_can_revoke() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        0,
        b"revoke-me",
    );

    client.revoke_attestation(&issuer, &id);
    assert_eq!(client.get_attestation(&id).status, ClaimStatus::Revoked);
    assert!(!client.is_attestation_valid(&id));
    assert_eq!(client.balance_of(&recipient), 0);
    assert!(!client.has_valid_claim(&recipient, &symbol_short!("KYC")));
}

#[test]
fn test_admin_can_revoke() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        0,
        b"revoke-me",
    );

    client.revoke_attestation(&admin, &id);
    assert_eq!(client.get_attestation(&id).status, ClaimStatus::Revoked);
}

#[test]
fn test_third_party_cannot_revoke() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        0,
        b"revoke-me",
    );

    let stranger = Address::generate(&env);
    let result = client.try_revoke_attestation(&stranger, &id);
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_double_revoke_fails() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        0,
        b"revoke-me",
    );

    client.revoke_attestation(&issuer, &id);
    let result = client.try_revoke_attestation(&issuer, &id);
    assert!(matches!(result, Err(Ok(Error::ClaimRevoked))));
}

// ── Non-transferability ───────────────────────────────────────────────────────

#[test]
fn test_transfer_is_blocked() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let other = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        0,
        b"soul",
    );

    let result = client.try_transfer(&recipient, &other, &id);
    assert!(matches!(result, Err(Ok(Error::NonTransferable))));
    assert_eq!(client.owner_of(&id), recipient);
}

#[test]
fn test_transfer_from_is_blocked() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let other = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        0,
        b"soul",
    );

    let result = client.try_transfer_from(&recipient, &recipient, &other, &id);
    assert!(matches!(result, Err(Ok(Error::NonTransferable))));
}

#[test]
fn test_approve_is_blocked() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let recipient = Address::generate(&env);
    let other = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &recipient,
        symbol_short!("KYC"),
        0,
        b"soul",
    );

    let result = client.try_approve(&recipient, &other, &id);
    assert!(matches!(result, Err(Ok(Error::ApprovalsDisabled))));
    assert_eq!(client.allowance(&recipient, &other), 0);
    assert!(client.non_transferable());
}

// ── Social recovery ───────────────────────────────────────────────────────────

fn guardians(env: &Env, addresses: &[Address]) -> soroban_sdk::Vec<Address> {
    let mut out = soroban_sdk::Vec::new(env);
    for address in addresses {
        out.push_back(address.clone());
    }
    out
}

#[test]
fn test_set_guardians_validates_threshold() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);
    let list = guardians(&env, &[g1, g2]);

    let result = client.try_set_guardians(&owner, &list, &3u32);
    assert!(matches!(result, Err(Ok(Error::InvalidThreshold))));
    let result = client.try_set_guardians(&owner, &list, &0u32);
    assert!(matches!(result, Err(Ok(Error::InvalidThreshold))));
}

#[test]
fn test_set_guardians_rejects_duplicates() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let list = guardians(&env, &[g1.clone(), g1]);
    let result = client.try_set_guardians(&owner, &list, &2u32);
    assert!(matches!(result, Err(Ok(Error::DuplicateGuardian))));
}

#[test]
fn test_recovery_migrates_active_claims() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);

    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &owner,
        symbol_short!("KYC"),
        0,
        b"credential",
    );

    client.set_guardians(&owner, &guardians(&env, &[g1.clone(), g2.clone()]), &2u32);
    client.start_recovery(&g1, &owner, &new_owner);
    client.approve_recovery(&g2, &owner);

    assert_eq!(client.owner_of(&id), new_owner);
    assert_eq!(client.balance_of(&new_owner), 1);
    assert_eq!(client.balance_of(&owner), 0);
    assert!(client.has_valid_claim(&new_owner, &symbol_short!("KYC")));
    assert!(!client.has_valid_claim(&owner, &symbol_short!("KYC")));
    // Guardian config is cleared after a successful recovery.
    assert_eq!(client.get_guardians(&owner).len(), 0);
}

#[test]
fn test_recovery_does_not_migrate_revoked_claims() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);

    let bad = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &owner,
        symbol_short!("KYC"),
        0,
        b"old",
    );
    client.revoke_attestation(&issuer, &bad);

    client.set_guardians(&owner, &guardians(&env, &[g1.clone(), g2.clone()]), &2u32);
    client.start_recovery(&g1, &owner, &new_owner);
    client.approve_recovery(&g2, &owner);

    assert_eq!(client.balance_of(&new_owner), 0);
    assert_eq!(client.get_attestation(&bad).recipient, owner);
}

#[test]
fn test_non_guardian_cannot_start_recovery() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);
    let stranger = Address::generate(&env);

    client.set_guardians(&owner, &guardians(&env, &[g1, g2]), &2u32);
    let result = client.try_start_recovery(&stranger, &owner, &new_owner);
    assert!(matches!(result, Err(Ok(Error::NotGuardian))));
}

#[test]
fn test_cannot_start_recovery_twice() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);

    client.set_guardians(&owner, &guardians(&env, &[g1.clone(), g2]), &2u32);
    client.start_recovery(&g1, &owner, &new_owner);
    let result = client.try_start_recovery(&g1, &owner, &new_owner);
    assert!(matches!(result, Err(Ok(Error::RecoveryAlreadyActive))));
}

#[test]
fn test_guardian_cannot_approve_twice() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);
    let g3 = Address::generate(&env);

    client.set_guardians(
        &owner,
        &guardians(&env, &[g1.clone(), g2, g3]),
        &3u32,
    );
    client.start_recovery(&g1, &owner, &new_owner);
    let result = client.try_approve_recovery(&g1, &owner);
    assert!(matches!(result, Err(Ok(Error::AlreadyApproved))));
}

#[test]
fn test_owner_can_cancel_recovery() {
    let (env, client, _admin) = setup();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);

    client.set_guardians(&owner, &guardians(&env, &[g1.clone(), g2]), &2u32);
    client.start_recovery(&g1, &owner, &new_owner);
    client.cancel_recovery(&owner);
    assert!(client.get_recovery(&owner).is_none());
    // A fresh recovery can now be started.
    client.start_recovery(&g1, &owner, &new_owner);
    assert!(client.get_recovery(&owner).is_some());
}

#[test]
fn test_recovery_requires_threshold() {
    let (env, client, admin) = setup();
    let (issuer, signing, pubkey) = register_issuer(&env, &client, &admin, 7);
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let g1 = Address::generate(&env);
    let g2 = Address::generate(&env);
    let id = issue(
        &env,
        &client,
        &issuer,
        &signing,
        &pubkey,
        &owner,
        symbol_short!("KYC"),
        0,
        b"credential",
    );

    client.set_guardians(&owner, &guardians(&env, &[g1.clone(), g2]), &2u32);
    client.start_recovery(&g1, &owner, &new_owner);
    // Only one of two required approvals so far.
    assert_eq!(client.owner_of(&id), owner);
    assert_eq!(client.balance_of(&new_owner), 0);
}
