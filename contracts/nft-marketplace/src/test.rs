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
    let payment_token_contract =
        env.register_stellar_asset_contract_v2(payment_token_admin.clone());
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

fn create_auction_listing(
    s: &TestSetup,
    seller: &Address,
    start_price: i128,
    duration: u64,
) -> u64 {
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
    let id1 = s.client.list_nft(
        &seller,
        &s.nft_contract,
        &100,
        &false,
        &3600,
        &royalty_recipient,
        &0u32,
    );
    let id2 = s.client.list_nft(
        &seller,
        &s.nft_contract,
        &200,
        &false,
        &3600,
        &royalty_recipient,
        &0u32,
    );
    let id3 = s.client.list_nft(
        &seller,
        &s.nft_contract,
        &300,
        &false,
        &3600,
        &royalty_recipient,
        &0u32,
    );
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

    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    // Buyer should now own the NFT
    assert_eq!(nft_client.balance(&buyer), 1);
    // Seller should have received payment minus fees
    let marketplace_fee = price * 25 / 1000; // 2.5%
    let expected_seller = price - marketplace_fee;
    assert_eq!(
        payment_client.balance(&seller),
        seller_balance_before + expected_seller
    );
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

    let result = s
        .client
        .try_buy_or_bid(&buyer, &listing_id, &s.payment_token, &500_000);
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
    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

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
    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    // Second buy on inactive listing should panic
    let buyer2 = Address::generate(&s.env);
    s.payment_sac.mint(&buyer2, &price);
    let result = s
        .client
        .try_buy_or_bid(&buyer2, &listing_id, &s.payment_token, &price);
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

    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &bid);

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

    let result = s
        .client
        .try_buy_or_bid(&bidder, &listing_id, &s.payment_token, &50_000);
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

    s.client
        .buy_or_bid(&bidder1, &listing_id, &s.payment_token, &bid1);
    s.client
        .buy_or_bid(&bidder2, &listing_id, &s.payment_token, &bid2);

    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    // bidder1 should be refunded
    assert_eq!(payment_client.balance(&bidder1), bid1);
    // bidder2's bid is escrowed
    assert_eq!(payment_client.balance(&bidder2), 0);
}

#[test]
fn test_auction_rejects_payment_token_change_without_moving_escrow() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder1 = Address::generate(&s.env);
    let bidder2 = Address::generate(&s.env);
    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    let bid1 = 200_000i128;
    let bid2 = 300_000i128;
    s.payment_sac.mint(&bidder1, &bid1);

    let alternate_admin = Address::generate(&s.env);
    let alternate_contract = s.env.register_stellar_asset_contract_v2(alternate_admin);
    let alternate_token = alternate_contract.address();
    let alternate_sac = StellarAssetClient::new(&s.env, &alternate_token);
    alternate_sac.mint(&bidder2, &bid2);

    s.client
        .buy_or_bid(&bidder1, &listing_id, &s.payment_token, &bid1);
    assert!(s
        .client
        .try_buy_or_bid(&bidder2, &listing_id, &alternate_token, &bid2)
        .is_err());

    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    let alternate_client = TokenClient::new(&s.env, &alternate_token);
    assert_eq!(payment_client.balance(&s.client.address), bid1);
    assert_eq!(payment_client.balance(&bidder1), 0);
    assert_eq!(alternate_client.balance(&bidder2), bid2);
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

    let result = s
        .client
        .try_buy_or_bid(&bidder, &listing_id, &s.payment_token, &200_000);
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
    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &bid);

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
fn test_settlement_rejects_a_different_token_and_preserves_escrow() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);
    let bid = 300_000i128;
    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.payment_sac.mint(&bidder, &bid);
    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &bid);

    let wrong_admin = Address::generate(&s.env);
    let wrong_token = s
        .env
        .register_stellar_asset_contract_v2(wrong_admin)
        .address();
    s.env.ledger().with_mut(|l| l.timestamp += 3601);

    assert!(s
        .client
        .try_settle_auction(&listing_id, &wrong_token)
        .is_err());
    let payment_client = TokenClient::new(&s.env, &s.payment_token);
    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    assert_eq!(payment_client.balance(&s.client.address), bid);
    assert_eq!(nft_client.balance(&s.client.address), 1);
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
    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

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
    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &200_000);

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

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #1000 — production-readiness coverage
//
// The suite above covers the happy paths and the explicit `panic!` guards. The
// cases below target what was left untested: exact boundaries, arithmetic
// conservation, state-machine transitions that can be reached twice, and the
// inputs the contract accepts today without validating.
//
// Several tests are written to document current behaviour that looks like a
// gap rather than a decision — each is marked GAP and asserts what the contract
// does now, so the suite fails loudly if that behaviour changes and a
// maintainer can decide whether to tighten the contract.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Boundaries ────────────────────────────────────────────────────────────────

#[test]
fn test_royalty_exactly_at_max_is_accepted() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let royalty_recipient = Address::generate(&s.env);
    s.nft_sac.mint(&seller, &1);

    // 100/1000 = 10% is the documented maximum. The guard is `> 100`, so the
    // boundary itself must be allowed — an off-by-one here would silently cap
    // royalties below the advertised limit.
    let listing_id = s.client.list_nft(
        &seller,
        &s.nft_contract,
        &1_000_000,
        &false,
        &3600,
        &royalty_recipient,
        &100u32,
    );

    assert_eq!(listing_id, 1);
}

#[test]
fn test_buy_at_exact_price_succeeds() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let price = 1_000_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&buyer, &price);

    // The guard is `bid_amount < price`, so paying exactly the asking price is
    // the boundary between success and `Insufficient payment`.
    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    assert_eq!(nft_client.balance(&buyer), 1);
}

#[test]
fn test_bid_one_stroop_above_previous_is_accepted() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let first = Address::generate(&s.env);
    let second = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.payment_sac.mint(&first, &200_000);
    s.payment_sac.mint(&second, &200_000);

    s.client
        .buy_or_bid(&first, &listing_id, &s.payment_token, &100_000);
    // The guard is `bid_amount <= highest_bid`, so a single stroop more is the
    // smallest valid raise.
    s.client
        .buy_or_bid(&second, &listing_id, &s.payment_token, &100_001);

    let listing: Listing = s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .unwrap()
    });
    assert_eq!(listing.highest_bid, 100_001);
    assert_eq!(listing.highest_bidder, Some(second));
}

#[test]
fn test_bid_equal_to_previous_is_rejected() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let first = Address::generate(&s.env);
    let second = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.payment_sac.mint(&first, &200_000);
    s.payment_sac.mint(&second, &200_000);

    s.client
        .buy_or_bid(&first, &listing_id, &s.payment_token, &150_000);
    let result = s
        .client
        .try_buy_or_bid(&second, &listing_id, &s.payment_token, &150_000);

    assert!(
        result.is_err(),
        "matching the highest bid must not win the auction"
    );
}

// ── Arithmetic conservation ───────────────────────────────────────────────────

#[test]
fn test_fixed_price_payment_splits_exactly_with_no_remainder_lost() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let royalty_recipient = Address::generate(&s.env);
    // Deliberately not divisible by 1000, so both fee and royalty truncate.
    let price = 1_234_567i128;

    s.nft_sac.mint(&seller, &1);
    let listing_id = s.client.list_nft(
        &seller,
        &s.nft_contract,
        &price,
        &false,
        &3600,
        &royalty_recipient,
        &75u32, // 7.5%
    );
    s.payment_sac.mint(&buyer, &price);

    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    let token = TokenClient::new(&s.env, &s.payment_token);
    let fee = token.balance(&s.fee_recipient);
    let royalty = token.balance(&royalty_recipient);
    let revenue = token.balance(&seller);

    // Every stroop the buyer paid must land somewhere. Truncation in the fee
    // and royalty calculations is absorbed by seller_revenue, so the three
    // payouts must reconstruct the price exactly.
    assert_eq!(
        fee + royalty + revenue,
        price,
        "payment was not fully distributed"
    );
    assert_eq!(token.balance(&buyer), 0);
    assert_eq!(fee, price * 25 / 1000);
    assert_eq!(royalty, price * 75 / 1000);
}

#[test]
fn test_auction_settlement_splits_escrowed_bid_exactly() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);
    let royalty_recipient = Address::generate(&s.env);
    let bid = 987_654i128;

    s.nft_sac.mint(&seller, &1);
    let listing_id = s.client.list_nft(
        &seller,
        &s.nft_contract,
        &100_000,
        &true,
        &3600,
        &royalty_recipient,
        &50u32, // 5%
    );
    s.payment_sac.mint(&bidder, &bid);
    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &bid);

    s.env.ledger().with_mut(|l| l.timestamp += 4000);
    s.client.settle_auction(&listing_id, &s.payment_token);

    let token = TokenClient::new(&s.env, &s.payment_token);
    let fee = token.balance(&s.fee_recipient);
    let royalty = token.balance(&royalty_recipient);
    let revenue = token.balance(&seller);

    assert_eq!(
        fee + royalty + revenue,
        bid,
        "escrowed bid was not fully paid out"
    );
    // The contract must not retain any of the escrow after settling.
    assert_eq!(
        token.balance(&s.client.address),
        0,
        "escrow left dust in the contract"
    );
}

#[test]
fn test_overpayment_is_distributed_not_refunded() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let price = 1_000_000i128;
    let paid = 1_500_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&buyer, &paid);

    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &paid);

    let token = TokenClient::new(&s.env, &s.payment_token);
    // Fees and revenue are computed from the amount paid, not the asking
    // price, so an overpaying buyer gets no change back. Documented here so
    // the behaviour is a decision rather than a surprise.
    assert_eq!(token.balance(&buyer), 0, "overpayment is not refunded");
    assert_eq!(token.balance(&s.fee_recipient), paid * 25 / 1000);
    assert_eq!(token.balance(&seller), paid - paid * 25 / 1000);
}

// ── Auction timing ────────────────────────────────────────────────────────────

#[test]
fn test_late_bid_extends_auction_end_time() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.payment_sac.mint(&bidder, &200_000);

    let before: Listing = s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .unwrap()
    });

    // Move to within the 10-minute anti-sniping window.
    s.env.ledger().with_mut(|l| l.timestamp += 3300);
    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &150_000);

    let after: Listing = s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .unwrap()
    });

    assert_eq!(
        after.end_time,
        before.end_time + 600,
        "a bid inside the final 10 minutes must extend the auction"
    );
}

#[test]
fn test_early_bid_does_not_extend_auction_end_time() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.payment_sac.mint(&bidder, &200_000);

    let before: Listing = s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .unwrap()
    });

    // Well outside the anti-sniping window — extending here would let a bidder
    // stretch an auction indefinitely with cheap early bids.
    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &150_000);

    let after: Listing = s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .unwrap()
    });

    assert_eq!(after.end_time, before.end_time);
}

#[test]
fn test_zero_duration_auction_is_immediately_closed_to_bids() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);

    // end_time == now, and the guard is `timestamp >= end_time`.
    let listing_id = create_auction_listing(&s, &seller, 100_000, 0);
    s.payment_sac.mint(&bidder, &200_000);

    let result = s
        .client
        .try_buy_or_bid(&bidder, &listing_id, &s.payment_token, &150_000);

    assert!(
        result.is_err(),
        "a zero-duration auction cannot accept bids"
    );
}

#[test]
fn test_settle_zero_duration_auction_returns_nft_to_seller() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 0);
    s.client.settle_auction(&listing_id, &s.payment_token);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    assert_eq!(nft_client.balance(&seller), 1);
}

// ── State machine: transitions reachable twice ────────────────────────────────

#[test]
fn test_settle_auction_twice_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let bidder = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.payment_sac.mint(&bidder, &200_000);
    s.client
        .buy_or_bid(&bidder, &listing_id, &s.payment_token, &150_000);

    s.env.ledger().with_mut(|l| l.timestamp += 4000);
    s.client.settle_auction(&listing_id, &s.payment_token);

    // A second settle must not pay the seller twice out of an empty escrow.
    let result = s.client.try_settle_auction(&listing_id, &s.payment_token);
    assert!(result.is_err(), "settling twice must fail");
}

#[test]
fn test_settle_cancelled_auction_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let listing_id = create_auction_listing(&s, &seller, 100_000, 3600);
    s.client.cancel_listing(&seller, &listing_id);

    s.env.ledger().with_mut(|l| l.timestamp += 4000);
    let result = s.client.try_settle_auction(&listing_id, &s.payment_token);

    // Cancelling already returned the NFT; settling must not move it again.
    assert!(
        result.is_err(),
        "a cancelled auction must not be settleable"
    );
}

#[test]
fn test_buy_after_sale_completes_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let first_buyer = Address::generate(&s.env);
    let second_buyer = Address::generate(&s.env);
    let price = 500_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&first_buyer, &price);
    s.payment_sac.mint(&second_buyer, &price);

    s.client
        .buy_or_bid(&first_buyer, &listing_id, &s.payment_token, &price);

    // The NFT is already gone; a second buyer must not be able to pay for it.
    let result = s
        .client
        .try_buy_or_bid(&second_buyer, &listing_id, &s.payment_token, &price);
    assert!(result.is_err());
}

#[test]
fn test_cancel_after_sale_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);
    let price = 500_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&buyer, &price);
    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &price);

    let result = s.client.try_cancel_listing(&seller, &listing_id);
    assert!(result.is_err(), "a sold listing must not be cancellable");
}

// ── Unknown listings ──────────────────────────────────────────────────────────

#[test]
fn test_buy_nonexistent_listing_panics() {
    let s = setup();
    let buyer = Address::generate(&s.env);
    s.payment_sac.mint(&buyer, &1_000_000);

    // The contract unwraps the storage read, so an unknown id is a panic
    // rather than a typed error.
    let result = s
        .client
        .try_buy_or_bid(&buyer, &9_999u64, &s.payment_token, &500_000);
    assert!(result.is_err());
}

#[test]
fn test_settle_nonexistent_listing_panics() {
    let s = setup();
    let result = s.client.try_settle_auction(&9_999u64, &s.payment_token);
    assert!(result.is_err());
}

#[test]
fn test_cancel_nonexistent_listing_panics() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let result = s.client.try_cancel_listing(&seller, &9_999u64);
    assert!(result.is_err());
}

// ── Multiple listings stay independent ────────────────────────────────────────

#[test]
fn test_listings_are_independent() {
    let s = setup();
    let seller_a = Address::generate(&s.env);
    let seller_b = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);

    let id_a = create_fixed_listing(&s, &seller_a, 100_000, 3600);
    let id_b = create_fixed_listing(&s, &seller_b, 200_000, 3600);
    assert_ne!(id_a, id_b);

    s.payment_sac.mint(&buyer, &100_000);
    s.client
        .buy_or_bid(&buyer, &id_a, &s.payment_token, &100_000);

    // Buying one listing must not disturb another.
    let listing_b: Listing = s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .persistent()
            .get(&DataKey::Listing(id_b))
            .unwrap()
    });
    assert!(listing_b.active, "unrelated listing was deactivated");
    assert_eq!(listing_b.price, 200_000);
}

// ── GAP: inputs accepted without validation ───────────────────────────────────

#[test]
fn test_gap_init_can_be_called_twice_and_overwrites_admin() {
    let s = setup();
    let new_admin = Address::generate(&s.env);
    let new_fee_recipient = Address::generate(&s.env);

    // GAP: `init` has no already-initialized guard, so anyone able to satisfy
    // the new admin's auth can seize the contract and redirect fees. Every
    // other contract in this repo guards this with an AlreadyInitialized
    // error. Asserted as current behaviour so tightening it fails here first.
    s.client.init(&new_admin, &new_fee_recipient);

    let stored: Address = s.env.as_contract(&s.client.address, || {
        s.env
            .storage()
            .instance()
            .get(&DataKey::FeeRecipient)
            .unwrap()
    });
    assert_eq!(
        stored, new_fee_recipient,
        "re-init overwrote the fee recipient — see GAP note"
    );
}

#[test]
fn test_gap_listing_count_is_not_reset_by_reinit() {
    let s = setup();
    let seller = Address::generate(&s.env);

    let first = create_fixed_listing(&s, &seller, 100_000, 3600);
    s.client.init(&s.admin, &s.fee_recipient);
    let second = create_fixed_listing(&s, &seller, 100_000, 3600);

    // GAP: re-init resets ListingCount to 0, so the next listing reuses an id
    // and overwrites a live listing. Here the second listing takes id 1 again.
    assert_eq!(first, 1);
    assert_eq!(
        second, 1,
        "re-init reset the counter and the id was reused — see GAP note"
    );
}

#[test]
fn test_gap_zero_price_fixed_listing_is_accepted() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let buyer = Address::generate(&s.env);

    // GAP: `list_nft` does not validate `price`, so a zero-price listing is
    // accepted and anyone can take the NFT for nothing.
    let listing_id = create_fixed_listing(&s, &seller, 0, 3600);
    s.client
        .buy_or_bid(&buyer, &listing_id, &s.payment_token, &0);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    assert_eq!(
        nft_client.balance(&buyer),
        1,
        "NFT transferred for zero payment — see GAP note"
    );
}

#[test]
fn test_gap_seller_can_buy_own_listing() {
    let s = setup();
    let seller = Address::generate(&s.env);
    let price = 100_000i128;

    let listing_id = create_fixed_listing(&s, &seller, price, 3600);
    s.payment_sac.mint(&seller, &price);

    // GAP: nothing stops a seller buying their own listing, which is the
    // standard wash-trading primitive — it inflates volume while costing the
    // seller only the 2.5% fee.
    s.client
        .buy_or_bid(&seller, &listing_id, &s.payment_token, &price);

    let nft_client = TokenClient::new(&s.env, &s.nft_contract);
    assert_eq!(nft_client.balance(&seller), 1);
}
