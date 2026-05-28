#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

#[test]
fn test_stake_and_unstake() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token.address();
    let sac = StellarAssetClient::new(&env, &token_addr);
    let token_client = TokenClient::new(&env, &token_addr);

    sac.mint(&user, &1000i128);

    let contract_id = env.register_contract(None, Staking);
    let client = StakingClient::new(&env, &contract_id);

    let unstake_period = 604800; // 7 days
    client.initialize(&admin, &token_addr, &unstake_period);

    let shares = client.stake(&user, &500i128);
    assert_eq!(shares, 500);

    let request_idx = client.request_unstake(&user, &500i128);

    // Advance time to unlock period
    env.ledger().with_mut(|l| l.timestamp += unstake_period + 1);

    let amount = client.claim_unstake(&user, &request_idx);
    assert_eq!(amount, 500);
    assert_eq!(token_client.balance(&user), 1000);
}
