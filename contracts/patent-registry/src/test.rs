#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::{PatentRegistry, PatentRegistryClient};
use crate::types::{Error, LicenseStatus, VerificationStatus};

fn setup() -> (Env, Address, Address, PatentRegistryClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, PatentRegistry);
    let client = PatentRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let verifier = Address::generate(&env);
    client.initialize(&admin, &verifier);
    (env, admin, verifier, client)
}

fn text(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}

#[test]
fn test_register_patent_stores_data() {
    let (env, _admin, _verifier, client) = setup();
    let owner = Address::generate(&env);

    let patent_id = client.register_patent(
        &owner,
        &text(&env, "Thermal Capture Wing"),
        &text(&env, "Aerodynamic energy harvesting panel"),
        &text(&env, "QmHash"),
        &text(&env, "ipfs://thermal-wing"),
    );

    let patent = client.get_patent(&patent_id);
    assert_eq!(patent.id, 1);
    assert_eq!(patent.owner, owner);
    assert_eq!(patent.verification_status, VerificationStatus::Pending);
    assert_eq!(client.patent_count(), 1);
}

#[test]
fn test_verify_patent_by_authorized_verifier() {
    let (env, _admin, verifier, client) = setup();
    let owner = Address::generate(&env);
    let patent_id = client.register_patent(
        &owner,
        &text(&env, "Acoustic Lattice"),
        &text(&env, "Noise-reduction structural lattice"),
        &text(&env, "QmAcoustic"),
        &text(&env, "ipfs://acoustic-lattice"),
    );

    client.verify_patent(&verifier, &patent_id);
    let patent = client.get_patent(&patent_id);
    assert_eq!(patent.verification_status, VerificationStatus::Verified);
    assert_eq!(patent.verifier, Some(verifier));
}

#[test]
fn test_unauthorized_verify_fails() {
    let (env, _admin, _verifier, client) = setup();
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);
    let patent_id = client.register_patent(
        &owner,
        &text(&env, "Hydro Weave"),
        &text(&env, "Capillary transport material"),
        &text(&env, "QmHydro"),
        &text(&env, "ipfs://hydro-weave"),
    );

    let result = client.try_verify_patent(&stranger, &patent_id);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_create_and_accept_license_offer() {
    let (env, _admin, _verifier, client) = setup();
    let owner = Address::generate(&env);
    let licensee = Address::generate(&env);
    let patent_id = client.register_patent(
        &owner,
        &text(&env, "Biofoil Mesh"),
        &text(&env, "Programmable wound dressing mesh"),
        &text(&env, "QmBiofoil"),
        &text(&env, "ipfs://biofoil"),
    );

    let offer_id = client.create_license_offer(
        &owner,
        &patent_id,
        &text(&env, "ipfs://license-terms"),
        &5000i128,
        &text(&env, "USDC"),
    );
    client.accept_license_offer(&licensee, &offer_id);

    let offer = client.get_license_offer(&offer_id);
    assert_eq!(offer.status, LicenseStatus::Accepted);
    assert_eq!(offer.licensee, Some(licensee));
}

#[test]
fn test_only_owner_can_update_patent_and_offer() {
    let (env, _admin, _verifier, client) = setup();
    let owner = Address::generate(&env);
    let stranger = Address::generate(&env);
    let patent_id = client.register_patent(
        &owner,
        &text(&env, "Pulse Matrix"),
        &text(&env, "Adaptive sensor matrix"),
        &text(&env, "QmPulse"),
        &text(&env, "ipfs://pulse-matrix"),
    );

    let update_result = client.try_update_patent(
        &stranger,
        &patent_id,
        &text(&env, "Pulse Matrix 2"),
        &text(&env, "Updated"),
        &text(&env, "QmPulse2"),
        &text(&env, "ipfs://pulse-matrix-v2"),
    );
    assert_eq!(update_result, Err(Ok(Error::Unauthorized)));

    let offer_id = client.create_license_offer(
        &owner,
        &patent_id,
        &text(&env, "ipfs://terms"),
        &750i128,
        &text(&env, "XLM"),
    );
    let offer_result = client.try_update_license_offer(
        &stranger,
        &offer_id,
        &text(&env, "ipfs://terms-v2"),
        &900i128,
        &text(&env, "XLM"),
    );
    assert_eq!(offer_result, Err(Ok(Error::Unauthorized)));
}

#[test]
fn test_pause_blocks_mutations() {
    let (env, admin, _verifier, client) = setup();
    let owner = Address::generate(&env);
    client.pause(&admin);

    let result = client.try_register_patent(
        &owner,
        &text(&env, "Paused Patent"),
        &text(&env, "Blocked while paused"),
        &text(&env, "QmPaused"),
        &text(&env, "ipfs://paused"),
    );

    assert_eq!(result, Err(Ok(Error::ContractPaused)));
    client.unpause(&admin);
    assert!(!client.paused());
}
