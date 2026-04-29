// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    vec, Env,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, NftAmmClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, NftAmm);
    let client = NftAmmClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None);
    (env, admin, client)
}

fn make_pool(
    env: &Env,
    client: &NftAmmClient,
    owner: &Address,
    pool_type: PoolType,
    curve: CurveType,
    spot: i128,
    delta: i128,
    fee_bps: i128,
) -> u32 {
    let nft = Address::generate(env);
    let token = Address::generate(env);
    client.create_pool(owner, &nft, &token, &curve, &pool_type, &spot, &delta, &fee_bps)
}

// ── Initialisation ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, admin, client) = setup();
    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin);
    assert!(!client.is_paused());
    assert_eq!(client.pool_count(), 0);
    assert_eq!(client.protocol_fee_bps(), 50); // default
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    let result = client.try_initialize(&admin, &None);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_initialize_custom_protocol_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, NftAmm);
    let client = NftAmmClient::new(&env, &id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &Some(100));
    assert_eq!(client.protocol_fee_bps(), 100);
}

// ── Pool creation ─────────────────────────────────────────────────────────────

#[test]
fn test_create_buy_pool() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 100_000, 0);
    assert_eq!(id, 1);
    assert_eq!(client.pool_count(), 1);
    let pool = client.get_pool(&id);
    assert_eq!(pool.spot_price, 1_000_000);
    assert!(pool.active);
}

#[test]
fn test_create_sell_pool() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Exponential, 2_000_000, 500, 0);
    assert_eq!(id, 1);
    let pool = client.get_pool(&id);
    assert_eq!(pool.pool_type, PoolType::Sell);
    assert_eq!(pool.curve, CurveType::Exponential);
}

#[test]
fn test_create_trade_pool() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Trade, CurveType::Linear, 1_000_000, 50_000, 100);
    let pool = client.get_pool(&id);
    assert_eq!(pool.fee_bps, 100);
}

#[test]
fn test_create_pool_invalid_spot_price_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let nft = Address::generate(&env);
    let token = Address::generate(&env);
    let result = client.try_create_pool(
        &owner, &nft, &token, &CurveType::Linear, &PoolType::Buy, &0, &0, &0,
    );
    assert_eq!(result, Err(Ok(Error::InvalidSpotPrice)));
}

#[test]
fn test_non_trade_pool_with_fee_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let nft = Address::generate(&env);
    let token = Address::generate(&env);
    let result = client.try_create_pool(
        &owner, &nft, &token, &CurveType::Linear, &PoolType::Buy, &1_000_000, &0, &100,
    );
    assert_eq!(result, Err(Ok(Error::InvalidFee)));
}

// ── Deposit ───────────────────────────────────────────────────────────────────

#[test]
fn test_deposit_tokens_to_buy_pool() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_tokens(&owner, &id, &5_000_000);
    assert_eq!(client.get_pool(&id).token_balance, 5_000_000);
}

#[test]
fn test_deposit_tokens_to_sell_pool_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    let result = client.try_deposit_tokens(&owner, &id, &1_000_000);
    assert_eq!(result, Err(Ok(Error::WrongPoolType)));
}

#[test]
fn test_deposit_nfts_to_sell_pool() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 1u64, 2u64, 3u64]);
    assert_eq!(client.get_pool(&id).nft_count, 3);
}

#[test]
fn test_deposit_nfts_to_buy_pool_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    let result = client.try_deposit_nfts(&owner, &id, &vec![&env, 1u64]);
    assert_eq!(result, Err(Ok(Error::WrongPoolType)));
}

// ── Buy NFT ───────────────────────────────────────────────────────────────────

#[test]
fn test_buy_nft_from_sell_pool_linear() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 100_000, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 42u64]);

    let buyer = Address::generate(&env);
    let (nft_id, price) = client.buy_nft(&buyer, &id, &2_000_000);

    assert_eq!(nft_id, 42);
    // price = spot(1_000_000) + protocol_fee(50 bps = 5000) = 1_005_000
    assert_eq!(price, 1_005_000);

    let pool = client.get_pool(&id);
    assert_eq!(pool.nft_count, 0);
    // spot price increased by delta
    assert_eq!(pool.spot_price, 1_100_000);
    assert_eq!(pool.trade_count, 1);
}

#[test]
fn test_buy_nft_from_sell_pool_exponential() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    // delta = 1000 bps = 10%
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Exponential, 1_000_000, 1_000, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 1u64]);

    let buyer = Address::generate(&env);
    client.buy_nft(&buyer, &id, &2_000_000);

    let pool = client.get_pool(&id);
    // new spot = 1_000_000 + 1_000_000 * 1000 / 10000 = 1_100_000
    assert_eq!(pool.spot_price, 1_100_000);
}

#[test]
fn test_buy_nft_slippage_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 1u64]);

    let buyer = Address::generate(&env);
    // max_price too low
    let result = client.try_buy_nft(&buyer, &id, &100);
    assert_eq!(result, Err(Ok(Error::InsufficientTokens)));
}

#[test]
fn test_buy_nft_no_nfts_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    let buyer = Address::generate(&env);
    let result = client.try_buy_nft(&buyer, &id, &2_000_000);
    assert_eq!(result, Err(Ok(Error::InsufficientNfts)));
}

#[test]
fn test_buy_nft_from_buy_pool_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    let buyer = Address::generate(&env);
    let result = client.try_buy_nft(&buyer, &id, &2_000_000);
    assert_eq!(result, Err(Ok(Error::WrongPoolType)));
}

// ── Sell NFT ──────────────────────────────────────────────────────────────────

#[test]
fn test_sell_nft_to_buy_pool_linear() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 100_000, 0);
    client.deposit_tokens(&owner, &id, &5_000_000);

    let seller = Address::generate(&env);
    let payout = client.sell_nft(&seller, &id, &99u64, &1);

    // payout = spot(1_000_000) - protocol_fee(5000) = 995_000
    assert_eq!(payout, 995_000);

    let pool = client.get_pool(&id);
    assert_eq!(pool.nft_count, 1);
    // spot price decreased by delta
    assert_eq!(pool.spot_price, 900_000);
    assert_eq!(pool.trade_count, 1);
}

#[test]
fn test_sell_nft_slippage_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_tokens(&owner, &id, &5_000_000);

    let seller = Address::generate(&env);
    // min_price too high
    let result = client.try_sell_nft(&seller, &id, &1u64, &999_999_999);
    assert_eq!(result, Err(Ok(Error::InsufficientTokens)));
}

#[test]
fn test_sell_nft_to_sell_pool_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    let seller = Address::generate(&env);
    let result = client.try_sell_nft(&seller, &id, &1u64, &1);
    assert_eq!(result, Err(Ok(Error::WrongPoolType)));
}

// ── Trade pool (two-sided) ────────────────────────────────────────────────────

#[test]
fn test_trade_pool_buy_and_sell() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    // 1% pool fee, linear, delta = 50_000
    let id = make_pool(&env, &client, &owner, PoolType::Trade, CurveType::Linear, 1_000_000, 50_000, 100);
    client.deposit_tokens(&owner, &id, &10_000_000);
    client.deposit_nfts(&owner, &id, &vec![&env, 10u64, 11u64]);

    let trader = Address::generate(&env);

    // Buy: pays spot + pool_fee + protocol_fee
    let (nft_id, buy_price) = client.buy_nft(&trader, &id, &2_000_000);
    assert!(buy_price > 1_000_000); // includes fees

    // Sell: receives spot - pool_fee - protocol_fee
    let sell_price = client.sell_nft(&trader, &id, &nft_id, &1);
    assert!(sell_price < buy_price); // spread captured by pool
}

// ── Withdraw ──────────────────────────────────────────────────────────────────

#[test]
fn test_withdraw_tokens() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_tokens(&owner, &id, &5_000_000);
    client.withdraw_tokens(&owner, &id, &3_000_000);
    assert_eq!(client.get_pool(&id).token_balance, 2_000_000);
}

#[test]
fn test_withdraw_nfts() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 1u64, 2u64, 3u64]);
    client.withdraw_nfts(&owner, &id, &2);
    assert_eq!(client.get_pool(&id).nft_count, 1);
}

#[test]
fn test_withdraw_too_many_tokens_fails() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_tokens(&owner, &id, &1_000_000);
    let result = client.try_withdraw_tokens(&owner, &id, &9_999_999);
    assert_eq!(result, Err(Ok(Error::InsufficientTokens)));
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_trades() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 1u64]);

    client.set_paused(&admin, &true);
    assert!(client.is_paused());

    let buyer = Address::generate(&env);
    let result = client.try_buy_nft(&buyer, &id, &2_000_000);
    assert_eq!(result, Err(Ok(Error::ContractPaused)));
}

#[test]
fn test_unpause_allows_trades() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 1u64]);

    client.set_paused(&admin, &true);
    client.set_paused(&admin, &false);

    let buyer = Address::generate(&env);
    client.buy_nft(&buyer, &id, &2_000_000);
}

// ── Price preview ─────────────────────────────────────────────────────────────

#[test]
fn test_get_buy_price_preview() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    let buy_price = client.get_buy_price(&id);
    // spot(1_000_000) + protocol_fee(50 bps = 5000) = 1_005_000
    assert_eq!(buy_price, 1_005_000);
}

#[test]
fn test_get_sell_price_preview() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    let sell_price = client.get_sell_price(&id);
    // spot(1_000_000) - protocol_fee(5000) = 995_000
    assert_eq!(sell_price, 995_000);
}

// ── Pool management ───────────────────────────────────────────────────────────

#[test]
fn test_deactivate_pool() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    client.deactivate_pool(&owner, &id);
    assert!(!client.get_pool(&id).active);
}

#[test]
fn test_update_pool_params() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    client.update_pool_params(&owner, &id, &2_000_000, &200_000);
    let pool = client.get_pool(&id);
    assert_eq!(pool.spot_price, 2_000_000);
    assert_eq!(pool.delta, 200_000);
}

#[test]
fn test_non_owner_cannot_update_pool() {
    let (env, _admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Buy, CurveType::Linear, 1_000_000, 0, 0);
    let impostor = Address::generate(&env);
    let result = client.try_update_pool_params(&impostor, &id, &2_000_000, &0);
    assert_eq!(result, Err(Ok(Error::Unauthorized)));
}

// ── Protocol fee collection ───────────────────────────────────────────────────

#[test]
fn test_protocol_fee_accumulates_on_buy() {
    let (env, admin, client) = setup();
    let owner = Address::generate(&env);
    let id = make_pool(&env, &client, &owner, PoolType::Sell, CurveType::Linear, 1_000_000, 0, 0);
    client.deposit_nfts(&owner, &id, &vec![&env, 1u64]);

    let buyer = Address::generate(&env);
    client.buy_nft(&buyer, &id, &2_000_000);

    // protocol_fee = 1_000_000 * 50 / 10000 = 5000
    assert_eq!(client.protocol_fee_balance(), 5_000);
}

#[test]
fn test_set_protocol_fee() {
    let (env, admin, client) = setup();
    client.set_protocol_fee(&admin, &200);
    assert_eq!(client.protocol_fee_bps(), 200);
}

#[test]
fn test_set_protocol_fee_too_high_fails() {
    let (env, admin, client) = setup();
    let result = client.try_set_protocol_fee(&admin, &9_999);
    assert_eq!(result, Err(Ok(Error::InvalidFee)));
}
