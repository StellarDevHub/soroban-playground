#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

#[test]
fn test_dutch_auction_price_discovery() {
    let env = Env::default();
    let contract_id = env.register_contract(None, DutchAuction);
    let client = DutchAuctionClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let nft = Address::generate(&env);
    let buyer = Address::generate(&env);

    let start_time = 1000;
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.mock_all_auths().initialize(
        &admin,
        &token,
        &nft,
        &1,
        &1000, // starting price
        &500,  // floor price
        &10,   // discount rate (10 per second)
        &start_time,
    );

    // Initial price should be starting price
    assert_eq!(client.get_price(), 1000);

    // Advance time by 10 seconds
    env.ledger().with_mut(|li| {
        li.timestamp = 1010;
    });

    // Price should be 1000 - (10 * 10) = 900
    assert_eq!(client.get_price(), 900);

    // Advance time by 60 seconds (total 60)
    env.ledger().with_mut(|li| {
        li.timestamp = 1060;
    });

    // Price should be 1000 - (60 * 10) = 400, but floor is 500
    assert_eq!(client.get_price(), 500);

    // Buy
    client.mock_all_auths().buy(&buyer);

    // After sold, price is 0
    assert_eq!(client.get_price(), 0);
}
