#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String,
};

use crate::{PatentRegistry, PatentRegistryClient};
use crate::types::{Error, LicenseStatus, PatentStatus};

fn setup() -> (Env, Address, Address, Address, PatentRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PatentRegistry);
    let client = PatentRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    let owner = Address::generate(&env);
    client.initialize(&admin, &verifier);
    (env, admin, verifier, owner, client)
}

fn patent_inputs(env: &Env) -> (String, String, String) {
    (
        String::from_str(env, "Sensorized Seed Planter"),
        String::from_str(env, "ipfs://patent-metadata"),
        String::from_str(env, "0xabc123deadbeef"),
    )
}

#[test]
fn test_register_and_verify_patent() {
    let (env, _admin, verifier, owner, client) = setup();
    let (title, uri, hash) = patent_inputs(&env);
    let patent_id = client.register_patent(&owner, &title, &uri, &hash);

    let patent = client.get_patent(&patent_id);
    assert_eq!(patent.owner, owner);
    assert_eq!(patent.status, PatentStatus::Registered);

    env.ledger().with_mut(|ledger| ledger.timestamp += 1_000);
    client.verify_patent(&verifier, &patent_id);

    let verified = client.get_patent(&patent_id);
    assert_eq!(verified.status, PatentStatus::Verified);
    assert!(verified.verified_at > 0);
}

#[test]
fn test_update_patent_by_owner() {
    let (env, _admin, _verifier, owner, client) = setup();
    let (title, uri, hash) = patent_inputs(&env);
    let patent_id = client.register_patent(&owner, &title, &uri, &hash);

    let updated_title = String::from_str(&env, "Seed Planter v2");
    let updated_uri = String::from_str(&env, "ipfs://updated-metadata");
    let updated_hash = String::from_str(&env, "0xdef456cafebabe");
    client.update_patent(&owner, &patent_id, &updated_title, &updated_uri, &updated_hash);

    let patent = client.get_patent(&patent_id);
    assert_eq!(patent.title, updated_title);
    assert_eq!(patent.metadata_hash, updated_hash);
}

#[test]
fn test_license_create_and_accept_flow() {
    let (env, _admin, verifier, owner, client) = setup();
    let (title, uri, hash) = patent_inputs(&env);
    let patent_id = client.register_patent(&owner, &title, &uri, &hash);
    client.verify_patent(&verifier, &patent_id);

    let licensee = Address::generate(&env);
    let terms = String::from_str(&env, "exclusive 12-month license");
    let currency = String::from_str(&env, "XLM");
    let license_id = client.create_license_offer(&owner, &patent_id, &licensee, &terms, &25_000, &currency);

    let license = client.get_license(&license_id);
    assert_eq!(license.status, LicenseStatus::Open);
    assert_eq!(license.licensee, licensee);

    let payment_reference = String::from_str(&env, "tx-001");
    client.accept_license(&licensee, &patent_id, &license_id, &payment_reference);

    let accepted = client.get_license(&license_id);
    assert_eq!(accepted.status, LicenseStatus::Accepted);
    assert_eq!(accepted.payment_reference, payment_reference);
}

#[test]
fn test_unauthorized_verification_fails() {
    let (env, _admin, _verifier, owner, client) = setup();
    let (title, uri, hash) = patent_inputs(&env);
    let patent_id = client.register_patent(&owner, &title, &uri, &hash);
    let stranger = Address::generate(&env);

    let result = client.try_verify_patent(&stranger, &patent_id);
    assert_eq!(result, Err(Ok(Error::NotVerifier)));
}

#[test]
fn test_pause_blocks_registration() {
    let (env, admin, _verifier, owner, client) = setup();
    let (title, uri, hash) = patent_inputs(&env);

    client.pause(&admin);

    let result = client.try_register_patent(&owner, &title, &uri, &hash);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}
