#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, BytesN, Vec,
};

#[test]
fn test_initialize_and_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let claimant = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Deploy a test SAC token
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token.address();
    let sac = StellarAssetClient::new(&env, &token_addr);
    let token_client = TokenClient::new(&env, &token_addr);

    // Mint tokens to admin
    sac.mint(&admin, &1000i128);

    // Deploy our airdrop contract
    let contract_id = env.register_contract(None, Airdrop);
    let client = AirdropClient::new(&env, &contract_id);

    // Initialize
    client.initialize(&admin);
    assert!(client.is_initialized());

    let amount = 500i128;
    let leaf = compute_leaf(&env, &claimant, amount);
    let proof = Vec::new(&env);
    let merkle_root = leaf;

    // Create airdrop
    let deadline = env.ledger().timestamp() + 100;
    client.create_airdrop(&token_addr, &merkle_root, &deadline, &500i128);

    // Claim
    client.claim(&claimant, &amount, &proof);

    assert_eq!(token_client.balance(&claimant), 500);
}
