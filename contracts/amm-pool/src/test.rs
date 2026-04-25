// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Env,
};

fn setup() -> (Env, Address, Address, Address, AmmPoolClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, AmmPool);
    let client = AmmPoolClient::new(&env, &id);
    let admin = Address::generate(&env);
    let token_a = Address::generate(&env);
    let token_b = Address::generate(&env);
    client.initialize(&admin, &token_a, &token_b, &None);
    (env, token_a, token_b, admin, client)
}

// ── Init ──────────────────────────────────────────────────────────────────────

#[test]
fn test_double_init_fails() {
    let (_env, ta, tb, admin, client) = setup();
    let result = client.try_initialize(&admin, &ta, &tb, &None);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_default_fee_bps() {
    let (_env, _ta, _tb, _admin, client) = setup();
    assert_eq!(client.get_fee_bps(), 30);
}

// ── Liquidity ─────────────────────────────────────────────────────────────────

#[test]
fn test_add_liquidity_first_deposit() {
    let (env, _ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    // sqrt(1000 * 1000) = 1000; minus MIN_LIQUIDITY(1000) = 0 → too small
    // Use larger amounts: sqrt(10_000 * 10_000) = 10_000 - 1000 = 9000
    let lp = client.add_liquidity(&provider, &10_000, &10_000, &1);
    assert_eq!(lp, 9_000);
    assert_eq!(client.get_lp_balance(&provider), 9_000);
    assert_eq!(client.get_reserves(), (10_000, 10_000));
}

#[test]
fn test_add_liquidity_proportional() {
    let (env, _ta, _tb, _admin, client) = setup();
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    client.add_liquidity(&p1, &10_000, &10_000, &1);
    // Second deposit: same ratio → proportional LP
    let lp2 = client.add_liquidity(&p2, &5_000, &5_000, &1);
    // total_lp after first = 10_000 (MIN_LIQUIDITY locked + 9000 to p1)
    // lp2 = min(5000*10000/10000, 5000*10000/10000) = 5000
    assert_eq!(lp2, 5_000);
}

#[test]
fn test_remove_liquidity() {
    let (env, _ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    let lp = client.add_liquidity(&provider, &10_000, &10_000, &1);
    let (out_a, out_b) = client.remove_liquidity(&provider, &lp, &1, &1);
    // provider holds 9000 of 10000 total LP → gets 90% of reserves
    assert_eq!(out_a, 9_000);
    assert_eq!(out_b, 9_000);
    assert_eq!(client.get_lp_balance(&provider), 0);
}

#[test]
fn test_remove_liquidity_slippage_fails() {
    let (env, _ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    let lp = client.add_liquidity(&provider, &10_000, &10_000, &1);
    // Demand more than available
    let result = client.try_remove_liquidity(&provider, &lp, &99_999, &1);
    assert_eq!(result, Err(Ok(Error::SlippageExceeded)));
}

// ── Swap ──────────────────────────────────────────────────────────────────────

#[test]
fn test_swap_a_to_b() {
    let (env, ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &100_000, &100_000, &1);

    let out = client.swap(&provider, &ta, &1_000, &1);
    // With 0.3% fee: out ≈ 990 (slightly less due to fee + price impact)
    assert!(out > 0 && out < 1_000);
    let (ra, rb) = client.get_reserves();
    assert_eq!(ra, 101_000);
    assert_eq!(rb, 100_000 - out);
}

#[test]
fn test_swap_slippage_protection() {
    let (env, ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &100_000, &100_000, &1);
    // Demand more output than possible
    let result = client.try_swap(&provider, &ta, &1_000, &99_999);
    assert_eq!(result, Err(Ok(Error::SlippageExceeded)));
}

#[test]
fn test_swap_invalid_token() {
    let (env, _ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    let bad_token = Address::generate(&env);
    client.add_liquidity(&provider, &100_000, &100_000, &1);
    let result = client.try_swap(&provider, &bad_token, &1_000, &1);
    assert_eq!(result, Err(Ok(Error::InvalidToken)));
}

#[test]
fn test_swap_zero_liquidity_fails() {
    let (env, ta, _tb, _admin, client) = setup();
    let trader = Address::generate(&env);
    let result = client.try_swap(&trader, &ta, &1_000, &1);
    assert_eq!(result, Err(Ok(Error::InsufficientLiquidity)));
}

// ── TWAP ──────────────────────────────────────────────────────────────────────

#[test]
fn test_twap_accumulates_after_swap() {
    let (env, ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &100_000, &100_000, &1);

    env.ledger().with_mut(|l| l.timestamp += 100);
    client.swap(&provider, &ta, &1_000, &1);

    let (pa, pb, _ts) = client.get_twap();
    assert!(pa > 0);
    assert!(pb > 0);
}

// ── get_amount_out preview ────────────────────────────────────────────────────

#[test]
fn test_get_amount_out_preview() {
    let (env, ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &100_000, &100_000, &1);
    let preview = client.get_amount_out(&1_000, &ta);
    let actual = client.swap(&provider, &ta, &1_000, &1);
    assert_eq!(preview, actual);
}
