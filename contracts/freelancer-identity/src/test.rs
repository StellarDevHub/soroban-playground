#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::types::Error;
use crate::{FreelancerIdentity, FreelancerIdentityClient};

fn setup() -> (
    Env,
    Address,
    Address,
    Address,
    FreelancerIdentityClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, FreelancerIdentity);
    let client = FreelancerIdentityClient::new(&env, &id);
    let admin = Address::generate(&env);
    let recovery = Address::generate(&env);
    let verifier = Address::generate(&env);
    client.initialize(&admin, &recovery);
    client.set_verifier(&admin, &verifier, &true);
    (env, admin, recovery, verifier, client)
}

fn register(env: &Env, client: &FreelancerIdentityClient, owner: &Address) {
    client.register_profile(owner, &11, &22);
    assert_eq!(client.get_profile(owner).portfolio_hash, 22);
}

#[test]
fn initialize_sets_defaults() {
    let (_, _, _, _, client) = setup();
    assert!(!client.is_paused());
    assert_eq!(client.get_stats().profile_count, 0);
}

#[test]
fn double_initialize_fails() {
    let (_, admin, recovery, _, client) = setup();
    assert_eq!(
        client.try_initialize(&admin, &recovery),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn register_profile_requires_hashes_and_uniqueness() {
    let (env, _, _, _, client) = setup();
    let freelancer = Address::generate(&env);
    assert_eq!(
        client.try_register_profile(&freelancer, &0, &22),
        Err(Ok(Error::EmptyField))
    );
    register(&env, &client, &freelancer);
    assert_eq!(client.get_stats().active_profiles, 1);
    assert_eq!(
        client.try_register_profile(&freelancer, &11, &22),
        Err(Ok(Error::ProfileAlreadyExists))
    );
}

#[test]
fn pause_blocks_user_actions() {
    let (env, admin, _, _, client) = setup();
    let freelancer = Address::generate(&env);
    client.set_paused(&admin, &true);
    assert_eq!(
        client.try_register_profile(&freelancer, &11, &22),
        Err(Ok(Error::Paused))
    );
}

#[test]
fn verifier_can_verify_portfolio_and_raise_reputation() {
    let (env, _, _, verifier, client) = setup();
    let freelancer = Address::generate(&env);
    register(&env, &client, &freelancer);
    let verification_id = client.verify_portfolio(&verifier, &freelancer, &100, &200, &90);
    let verification = client.get_verification(&verification_id);
    let profile = client.get_profile(&freelancer);

    assert_eq!(verification.score, 90);
    assert_eq!(profile.verified_projects, 1);
    assert_eq!(profile.reputation, 90);
}

#[test]
fn non_verifier_cannot_verify() {
    let (env, _, _, _, client) = setup();
    let freelancer = Address::generate(&env);
    let stranger = Address::generate(&env);
    register(&env, &client, &freelancer);
    assert_eq!(
        client.try_verify_portfolio(&stranger, &freelancer, &100, &200, &90),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn skill_endorsements_update_subject_reputation() {
    let (env, _, _, verifier, client) = setup();
    let freelancer = Address::generate(&env);
    let endorser = Address::generate(&env);
    register(&env, &client, &freelancer);
    register(&env, &client, &endorser);
    client.verify_portfolio(&verifier, &endorser, &100, &200, &80);

    let id = client.endorse_skill(&endorser, &freelancer, &333, &444, &5);
    let endorsement = client.get_endorsement(&id);
    let profile = client.get_profile(&freelancer);

    assert_eq!(endorsement.weight, 5);
    assert_eq!(profile.endorsement_count, 1);
    assert_eq!(profile.reputation, 10);
}

#[test]
fn cannot_self_endorse_or_use_invalid_weight() {
    let (env, _, _, _, client) = setup();
    let freelancer = Address::generate(&env);
    let endorser = Address::generate(&env);
    register(&env, &client, &freelancer);
    register(&env, &client, &endorser);

    assert_eq!(
        client.try_endorse_skill(&freelancer, &freelancer, &333, &444, &5),
        Err(Ok(Error::SelfEndorsement))
    );
    assert_eq!(
        client.try_endorse_skill(&endorser, &freelancer, &333, &444, &11),
        Err(Ok(Error::InvalidWeight))
    );
}

#[test]
fn admin_can_revoke_endorsement_once() {
    let (env, admin, _, _, client) = setup();
    let freelancer = Address::generate(&env);
    let endorser = Address::generate(&env);
    register(&env, &client, &freelancer);
    register(&env, &client, &endorser);

    let id = client.endorse_skill(&endorser, &freelancer, &333, &444, &5);
    client.revoke_endorsement(&admin, &id);
    assert!(client.get_endorsement(&id).revoked);
    assert_eq!(
        client.try_revoke_endorsement(&admin, &id),
        Err(Ok(Error::AlreadyRevoked))
    );
}

#[test]
fn recovery_can_rotate_wallet() {
    let (env, _, recovery, _, client) = setup();
    let old_owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    register(&env, &client, &old_owner);

    client.recover_profile(&recovery, &old_owner, &new_owner);
    assert!(!client.get_profile(&old_owner).active);
    assert!(client.get_profile(&new_owner).active);
    assert_eq!(client.get_stats().active_profiles, 1);
}
