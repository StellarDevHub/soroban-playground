#![cfg(test)]
use super::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

fn setup() -> (Env, CharityTrackerContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token = token_contract.address();

    let contract_id = env.register_contract(None, CharityTrackerContract);
    let client = CharityTrackerContractClient::new(&env, &contract_id);

    (env, client, admin, token)
}

#[test]
fn test_initialize() {
    let (_env, client, admin, token) = setup();
    client.initialize(&admin, &token);
}

#[test]
fn test_create_campaign() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let id = client.create_campaign(
        &Address::generate(&env),
        &String::from_str(&env, "Clean Water"),
        &String::from_str(&env, "Provide clean water"),
        &100_000,
        &3,
    );
    assert_eq!(id, 1);
}

#[test]
fn test_donate() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let donor = Address::generate(&env);

    let token_admin_client = token::StellarAssetClient::new(&env, &token);
    token_admin_client.mint(&donor, &100_000);

    let id = client.create_campaign(
        &Address::generate(&env),
        &String::from_str(&env, "Fund"),
        &String::from_str(&env, "Desc"),
        &100_000,
        &2,
    );
    let donation_id = client.donate(&donor, &id, &50_000);
    assert_eq!(donation_id, 1);
    let campaign = client.get_campaign(&id);
    assert_eq!(campaign.raised_amount, 50_000);
}

#[test]
fn test_milestone_flow() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let organizer = Address::generate(&env);
    let id = client.create_campaign(
        &organizer,
        &String::from_str(&env, "Fund"),
        &String::from_str(&env, "Desc"),
        &100_000,
        &1,
    );
    client.add_milestone(
        &organizer,
        &id,
        &1,
        &String::from_str(&env, "Build well"),
        &50_000,
    );
    client.complete_milestone(
        &organizer,
        &id,
        &1,
        &String::from_str(&env, "proof_hash"),
    );
    client.verify_milestone(&admin, &id, &1);
    let m = client.get_milestone(&id, &1);
    assert!(m.verified);
}

#[test]
fn test_direct_impact_allocation() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let donor = Address::generate(&env);
    let organizer = Address::generate(&env);

    let token_admin_client = token::StellarAssetClient::new(&env, &token);
    token_admin_client.mint(&donor, &100_000);

    let id = client.create_campaign(
        &organizer,
        &String::from_str(&env, "Education"),
        &String::from_str(&env, "Build School"),
        &100_000,
        &2,
    );

    client.add_milestone(
        &organizer,
        &id,
        &1,
        &String::from_str(&env, "Phase 1"),
        &50_000,
    );

    client.donate(&donor, &id, &25_000);
    client.allocate_direct_impact(&donor, &id, &1, &25_000);

    let impact = client.get_donor_impact(&donor, &id);
    assert_eq!(impact.total_donated, 25_000);
    assert_eq!(impact.allocated_amount, 25_000);
    assert_eq!(impact.milestones_supported, 1);
}

#[test]
fn test_dao_milestone_validation() {
    let (env, client, admin, token) = setup();
    client.initialize(&admin, &token);
    let organizer = Address::generate(&env);
    let validator = Address::generate(&env);

    client.add_dao_validator(&admin, &validator);

    let id = client.create_campaign(
        &organizer,
        &String::from_str(&env, "Health"),
        &String::from_str(&env, "Clinic"),
        &100_000,
        &1,
    );

    client.add_milestone(
        &organizer,
        &id,
        &1,
        &String::from_str(&env, "Equipment"),
        &50_000,
    );

    client.complete_milestone(
        &organizer,
        &id,
        &1,
        &String::from_str(&env, "proof_ipfs_hash"),
    );

    client.vote_validate_milestone(&validator, &id, &1, &true);
    let m = client.get_milestone(&id, &1);
    assert!(m.verified);
    let val = client.get_milestone_validation(&id, &1);
    assert!(val.validation_status);
    assert_eq!(val.votes_for, 1);
}
