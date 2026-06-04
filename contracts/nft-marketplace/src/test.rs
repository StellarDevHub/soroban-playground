// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct TestSetup {
    env: Env,
    admin: Address,
    fee_recipient: Address,
    client: NftMarketplaceClient<'static>,
    payment_token: Address,
    nft_contract: Address,
    payment_sac: StellarAssetClient<'static>,
    nft_sac: StellarAssetClient<'static>,
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    // Deploy marketplace contract
    let contract_id = env.register_contract(None, NftMarketplace);
    let client = NftMarketplaceClient::new(&env, &contract_id);
    client.init(&admin, &fee_recipient);

    // Deploy payment token (SAC)
    let payment_token_admin = Address::generate(&env);
    let payment_token_contract = env.register_stellar_asset_contract_v2(payment_token_admin.clone());
    let payment_token = payment_token_contract.address();
    let payment_sac = StellarAssetClient::new(&env, &payment_token);

    // Deploy NFT token (SAC, treated as NFT with amount=1)
    let nft_token_admin = Address::generate(&env);
    let nft_token_contract = env.register_stellar_asset_contract_v2(nft_token_admin.clone());
    let nft_contract = nft_token_contract.address();
    let nft_sac = StellarAssetClient::new(&env, &nft_contract);

    TestSetup {
        env,
        admin,
        fee_recipient,
        client,
        payment_token,
        nft_contract,
        payment_sac,
        nft_sac,
    }
}

fn create_fixed_listing(s: &TestSetup, seller: &Address, price: i128, duration: u64) -> u64 {
    let royalty_recipient = Address::generate(&s.env);
    // Mint NFT to seller
    s.nft_sac.mint(seller, &1);
    s.client.list_nft(
        seller,
        &s.nft_contract,
        &price,
        &false,
        &duration,
        &royalty_recipient,
        &0u32,
    )
}

fn create_auction_listing(s: &TestSetup, seller: &Address, start_price: i128, duration: u64) -> u64 {
    let royalty_recipient = Address::generate(&s.env);
    s.nft_sac.mint(seller, &1);
    s.client.list_nft(
        seller,
        &s.nft_contract,
        &start_price,
        &true,
        &duration,
        &royalty_recipient,
        &0u32,
    )
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_init_ok() {
    let s = setup();
    // If we get here without panic, init succeeded
    let _ = &s.client;
}

// ── List NFT ──────────────────────────────────────────────────────────────────

#[test]
fn test_list_nft_fixed_price() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let listing_id = create_fixed_listing(&s, &seller, 1_000_000, 3600);
    assert_eq!(listing_id, 1);
}

#[test]
fn test_list_nft_increments_count() {
    let s = setup();
    let seller = Address::generate(&s.env);
    s.nft_sac.mint(&seller, &3);
    let royalty_recipient = Address::generate(&s.env);
    let id1 = s.client.list_nft(&seller, &s.nft_contract, &100, &false, &3600, &royalty_recipient, &0u32);
    let id2 = s.client.list_nft(&seller, &s.nft_contract, &200, &false, &3600, &royalty_recipient, &0u32);
    let id3 = s.client.list_nft(&seller, &s.nft_contract, &300, &false, &3600, &royalty_recipient, &0u32);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(id3, 3);
}

#[test]
fn test_list_nft_auction() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let listing_id = create_auction_listing(&s, &seller, 500_000, 7200);
    assert_eq!(listing_id, 1);
}

#[test]
fn test_list_nft_royalty_too_high_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let royalty_recipient = Address::generate(&s.env);
    s.nft_sac.mint(&seller, &1);
    let result = s.client.try_list_nft(
        &seller,
        &s.nft_contract,
        &1_000_000,
        &false,
        &3600,
        &royalty_recipient,
        &101u32, // > 100 → panic
    );
    assert!(result.is_err());
}

// ── Buy (fixed price) ─────────────────────────────────────────────────────────

#[test]
fn test_buy_fixed_price_ok() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let price = 1_000_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);

    // Mint payment tokens to buyer
    s.payment_sac.mint(&buyer, &price);

    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    let nft_client = TokenClient::new(&s.env, &s.nft_contract);

    let seller_balance_before = payment_client.balance(&seller);

    s.client.buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    // Buyer should now own the NFT
    assert_eq!(nft_client.balance(&buyer), 1);
    // Seller should have received payment minus fees
    let marketplace_fee = price * 25 / 1000; // 2.5%
    let expected_seller = price - marketplace_fee;
    assert_eq!(payment_client.balance(&seller), seller_balance_before + expected_seller);
    // Fee recipient should have received the fee
    assert_eq!(payment_client.balance(&s.fee_recipient), marketplace_fee);
}

#[test]
fn test_buy_insufficient_payment_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let price = 1_000_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&buyer, &500_000); // less than price

    let result = s.client.try_buy_or_bid(&buyer, &listing_id, &s.payment_token, &500_000);
    assert!(result.is_err());
}

#[test]
fn test_buy_with_royalty() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let royalty_recipient = Address::generate(&s.env);
    let price = 1_000_000i128;
    let royalty_percent = 25u32; // 2.5%

    s.nft_sac.mint(&seller, &1);
    let listing_id = s.client.list_nft(
        &seller,
        &s.nft_contract,
        &price,
        &false,
        &3600,
        &royalty_recipient,
        &royalty_percent,
    );

    s.payment_sac.mint(&buyer, &price);
    s.client.buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    let royalty_amount = price * royalty_percent as i128 / 1000;
    assert_eq!(payment_client.balance(&royalty_recipient), royalty_amount);
}

#[test]
fn test_buy_inactive_listing_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let price = 1_000_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&buyer, &price);

    // First buy succeeds
    s.client.buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    // Second buy on inactive listing should panic
    let buyer2 = Address::generate(&s.env);
    s.payment_sac.mint(&buyer2, &price);
    let result = s.client.try_buy_or_bid(&buyer2, &listing_id, &s.payment_token, &price);
    assert!(result.is_err());
}

// ── Auction ───────────────────────────────────────────────────────────────────

#[test]
fn test_auction_bid_ok() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);
    let start_price = 100_000i128;
    let bid = 200_000i128;

    let listing_id = create_auction_listing(&s, &seller, start_price, 3600);
    s.payment_sac.mint(&bidder, &bid);

    s.client.buy_or_bid(&bidder, &listing_id, &s.payment_token, &bid);

    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    // Bid is escrowed in the contract
    assert_eq!(payment_client.balance(&bidder), 0);
}

#[test]
fn test_auction_bid_too_low_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);
    let start_price = 100_000i128;

    let listing_id = create_auction_listing(&s, &seller, start_price, 3600);
    s.payment_sac.mint(&bidder, &50_000);

    let result = s.client.try_buy_or_bid(&bidder, &listing_id, &s.payment_token, &50_000);
    assert!(result.is_err());
}

#[test]
fn test_auction_outbid_refunds_previous_bidder() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder1 = Address::generate(&s.env);
    let bidder2 = Address::generate(&s.env);
    let start_price = 100_000i128;
    let bid1 = 200_000i128;
    let bid2 = 300_000i128;

    let listing_id = create_auction_listing(&s, &seller, start_price, 3600);
    s.payment_sac.mint(&bidder1, &bid1);
    s.payment_sac.mint(&bidder2, &bid2);

    s.client.buy_or_bid(&bidder1, &listing_id, &s.payment_token, &bid1);
    s.client.buy_or_bid(&bidder2, &listing_id, &s.payment_token, &bid2);

    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    // bidder1 should be refunded
    assert_eq!(payment_client.balance(&bidder1), bid1);
    // bidder2's bid is escrowed
    assert_eq!(payment_client.balance(&bidder2), 0);
}

#[test]
fn test_auction_bid_after_end_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);
    let start_price = 100_000i128;

    let listing_id = create_auction_listing(&s, &seller, start_price, 3600);
    s.payment_sac.mint(&bidder, &200_000);

    // Advance past auction end
    s.env.ledger().with_mut(|l| l.timestamp += 3601);

    let result = s.client.try_buy_or_bid(&bidder, &listing_id, &s.payment_token, &200_000);
    assert!(result.is_err());
}

// ── Settle Auction ────────────────────────────────────────────────────────────

#[test]
fn test_settle_auction_with_winner() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);
    let start_price = 100_000i128;
    let bid = 500_000i128;

    let listing_id = create_auction_listing(&s, &seller, start_price, 3600);
    s.payment_sac.mint(&bidder, &bid);
    s.client.buy_or_bid(&bidder, &listing_id, &s.payment_token, &bid);

    // Advance past auction end
    s.env.ledger().with_mut(|l| l.timestamp += 3601);
    s.client.settle_auction(&listing_id, &s.payment_token);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    // Winner should own the NFT
    assert_eq!(nft_client.balance(&bidder), 1);

    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    let marketplace_fee = bid * 25 / 1000;
    let expected_seller = bid - marketplace_fee;
    assert_eq!(payment_client.balance(&seller), expected_seller);
    assert_eq!(payment_client.balance(&s.fee_recipient), marketplace_fee);
}

#[test]
fn test_settle_auction_no_bids_returns_nft_to_seller() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);

    // Advance past auction end without any bids
    s.env.ledger().with_mut(|l| l.timestamp += 3601);
    s.client.settle_auction(&listing_id, &s.payment_token);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    // NFT returned to seller
    assert_eq!(nft_client.balance(&seller), 1);
}

#[test]
fn test_settle_auction_before_end_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);

    // Do NOT advance past end
    let result = s.client.try_settle_auction(&listing_id, &s.payment_token);
    assert!(result.is_err());
}

#[test]
fn test_settle_fixed_price_listing_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let listing_id = create_fixed_listing(&s, &seller, 100_000, 3600);
    s.env.ledger().with_mut(|l| l.timestamp += 3601);

    let result = s.client.try_settle_auction(&listing_id, &s.payment_token);
    assert!(result.is_err());
}

// ── Cancel Listing ────────────────────────────────────────────────────────────

#[test]
fn test_cancel_listing_ok() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let listing_id = create_fixed_listing(&s, &seller, 1_000_000, 3600);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    // NFT is held by contract
    assert_eq!(nft_client.balance(&seller), 0);

    s.client.cancel_listing(&seller, &listing_id);

    // NFT returned to seller
    assert_eq!(nft_client.balance(&seller), 1);
}

#[test]
fn test_cancel_listing_not_seller_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let other = Address::generate(&s.env);

    let listing_id = create_fixed_listing(&s, &seller, 1_000_000, 3600);

    let result = s.client.try_cancel_listing(&other, &listing_id);
    assert!(result.is_err());
}

#[test]
fn test_cancel_listing_already_inactive_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let price = 1_000_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&buyer, &price);
    s.client.buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    // Listing is now inactive
    let result = s.client.try_cancel_listing(&seller, &listing_id);
    assert!(result.is_err());
}

#[test]
fn test_cancel_auction_with_bids_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.payment_sac.mint(&bidder, &200_000);
    s.client.buy_or_bid(&bidder, &listing_id, &s.payment_token, &200_000);

    let result = s.client.try_cancel_listing(&seller, &listing_id);
    assert!(result.is_err());
}

#[test]
fn test_cancel_auction_without_bids_ok() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.client.cancel_listing(&seller, &listing_id);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    assert_eq!(nft_client.balance(&seller), 1);
}
