#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{vec, Env, IntoVal};

#[test]
fn test_real_estate_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let buyer = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract(Address::generate(&env));
    
    let contract_id = env.register_contract(None, RealEstateTokenization);
    let client = RealEstateTokenizationClient::new(&env, &contract_id);

    client.init(&admin);

    let prop_id = client.list_property(
        &owner,
        &symbol_short!("Villa"),
        &1000, // 1000 shares
        &100,  // 100 tokens per share
        &symbol_short!("url"),
    );

    assert_eq!(prop_id, 1);

    // Buyer buys 100 shares
    client.buy_shares(&buyer, &prop_id, &100, &token_id);
    assert_eq!(client.get_shares(&prop_id, &buyer), 100);

    // Owner deposits rent
    client.deposit_rent(&prop_id, &10000, &token_id);

    // Buyer claims rent (10% of 10000 = 1000)
    client.claim_rent(&buyer, &prop_id, &token_id);
}
