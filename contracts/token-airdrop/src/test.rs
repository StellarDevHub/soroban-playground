#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env,
};

use crate::{TokenAirdrop, TokenAirdropClient};
use crate::types::Error;

fn setup_env() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, TokenAirdrop);

    // Create a test token
    let token_id = env.register_stellar_asset_contract_v2(admin.clone()).address();

    (env, admin, contract_id, token_id)
}

fn mint_tokens(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
    let _ = admin;
}

#[test]
fn test_initialize() {
    let (env, admin, contract_id, _token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, contract_id, _token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_pause_unpause() {
    let (env, admin, contract_id, _token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    client.pause();
    assert!(client.is_paused());
    client.unpause();
    assert!(!client.is_paused());
}

#[test]
fn test_create_campaign_and_claim() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin,
        &token,
        &100_i128,
        &1_000_000_i128,
        &now,
        &(now + 86400),
        &false,
    );
    assert_eq!(campaign_id, 1);

    let claimer = Address::generate(&env);
    let claimed = client.claim(&campaign_id, &claimer);
    assert_eq!(claimed, 100);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&claimer), 100);
}

#[test]
fn test_double_claim_fails() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin, &token, &100_i128, &1_000_000_i128, &now, &(now + 86400), &false,
    );

    let claimer = Address::generate(&env);
    client.claim(&campaign_id, &claimer);
    let result = client.try_claim(&campaign_id, &claimer);
    assert_eq!(result, Err(Ok(Error::AlreadyClaimed)));
}

#[test]
fn test_allowlist_claim() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin, &token, &100_i128, &1_000_000_i128, &now, &(now + 86400), &true,
    );

    let allowed = Address::generate(&env);
    let not_allowed = Address::generate(&env);

    client.add_to_allowlist(&campaign_id, &vec![&env, allowed.clone()]);

    // Allowed address can claim
    let claimed = client.claim(&campaign_id, &allowed);
    assert_eq!(claimed, 100);

    // Non-allowlisted address cannot claim
    let result = client.try_claim(&campaign_id, &not_allowed);
    assert_eq!(result, Err(Ok(Error::NotEligible)));
}

#[test]
fn test_batch_distribute() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin, &token, &100_i128, &1_000_000_i128, &now, &(now + 86400), &false,
    );

    let r1 = Address::generate(&env);
    let r2 = Address::generate(&env);
    let r3 = Address::generate(&env);

    let distributed = client.batch_distribute(&campaign_id, &vec![&env, r1.clone(), r2.clone(), r3.clone()]);
    assert_eq!(distributed, 300);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&r1), 100);
    assert_eq!(token_client.balance(&r2), 100);
    assert_eq!(token_client.balance(&r3), 100);
}

#[test]
fn test_claim_before_start_fails() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin, &token, &100_i128, &1_000_000_i128,
        &(now + 1000), &(now + 86400), &false,
    );

    let claimer = Address::generate(&env);
    let result = client.try_claim(&campaign_id, &claimer);
    assert_eq!(result, Err(Ok(Error::AirdropNotStarted)));
}

#[test]
fn test_claim_after_expiry_fails() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin, &token, &100_i128, &1_000_000_i128, &now, &(now + 100), &false,
    );

    // Advance ledger past expiry
    env.ledger().with_mut(|l| l.timestamp = now + 200);

    let claimer = Address::generate(&env);
    let result = client.try_claim(&campaign_id, &claimer);
    assert_eq!(result, Err(Ok(Error::AirdropExpired)));
}

#[test]
fn test_claim_while_paused_fails() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin, &token, &100_i128, &1_000_000_i128, &now, &(now + 86400), &false,
    );

    client.pause();
    let claimer = Address::generate(&env);
    let result = client.try_claim(&campaign_id, &claimer);
    assert_eq!(result, Err(Ok(Error::Paused)));
}

#[test]
fn test_end_campaign_returns_funds() {
    let (env, admin, contract_id, token) = setup_env();
    let client = TokenAirdropClient::new(&env, &contract_id);

    client.initialize(&admin);
    mint_tokens(&env, &token, &admin, &admin, 1_000_000);

    let now = env.ledger().timestamp();
    let campaign_id = client.create_campaign(
        &admin, &token, &100_i128, &1_000_000_i128, &now, &(now + 86400), &false,
    );

    let token_client = TokenClient::new(&env, &token);
    let before = token_client.balance(&admin);

    let returned = client.end_campaign(&campaign_id);
    assert_eq!(returned, 1_000_000);
    assert_eq!(token_client.balance(&admin), before + 1_000_000);
}
