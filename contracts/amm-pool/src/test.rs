// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use proptest::prelude::*;
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

// ── NFT Collection Analytics ──────────────────────────────────────────────────

#[test]
fn test_initialize_nft_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, AmmPool);
    let client = AmmPoolClient::new(&env, &id);
    let admin = Address::generate(&env);
    let token_a = Address::generate(&env);
    let token_b = Address::generate(&env);
    let nft_collection = Address::generate(&env);

    client.initialize_nft(&admin, &token_a, &token_b, &nft_collection, &None);

    // Verify pool is initialized
    assert_eq!(client.get_fee_bps(), 30);

    // Verify collection stats are initialized
    let stats = client.get_collection_stats();
    assert_eq!(stats.floor_price, 0);
    assert_eq!(stats.ceiling_price, 0);
    assert_eq!(stats.total_volume, 0);
    assert_eq!(stats.trade_count, 0);
}

#[test]
fn test_update_floor_price() {
    let (env, _ta, _tb, admin, client) = setup();
    let nft_collection = Address::generate(&env);
    client.initialize_nft(&admin, &_ta, &_tb, &nft_collection, &None);

    // Update floor price
    client.update_floor_price(&admin, &1_000);

    let floor = client.get_floor_price();
    assert_eq!(floor, 1_000);

    // Verify stats updated
    let stats = client.get_collection_stats();
    assert_eq!(stats.floor_price, 1_000);
}

#[test]
fn test_pool_metrics_track_volume() {
    let (env, ta, _tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &100_000, &100_000, &1);

    // Perform swaps
    client.swap(&provider, &ta, &1_000, &1);
    client.swap(&provider, &ta, &2_000, &1);

    let (volume, fees) = client.get_pool_metrics();
    assert_eq!(volume, 3_000); // Total input volume
    assert!(fees > 0); // Fees collected
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn liquidity_operations_preserve_lp_supply(
        operations in prop::collection::vec(
            (0u8..3, 0usize..2, 2_000i128..10_000, 2_000i128..10_000),
            1..30
        )
    ) {
        let (env, token_a, token_b, _admin, client) = setup();
        let providers = [Address::generate(&env), Address::generate(&env)];

        for (operation, provider_index, amount_a, amount_b) in operations {
            let provider = &providers[provider_index];
            match operation {
                0 => {
                    let _ = client.try_add_liquidity(
                        provider,
                        &amount_a,
                        &amount_b,
                        &0,
                    );
                }
                1 => {
                    let available = client.get_lp_balance(provider);
                    let requested = amount_a.min(available);
                    if requested > 0 {
                        let _ = client.try_remove_liquidity(
                            provider,
                            &requested,
                            &0,
                            &0,
                        );
                    }
                }
                _ => {
                    let token_in = if amount_a % 2 == 0 {
                        &token_a
                    } else {
                        &token_b
                    };
                    let _ = client.try_swap(provider, token_in, &amount_b, &1);
                }
            }

            let total_lp = client.get_total_lp();
            let provider_lp: i128 = providers
                .iter()
                .map(|address| client.get_lp_balance(address))
                .sum();
            if total_lp == 0 {
                prop_assert_eq!(provider_lp, 0);
            } else {
                prop_assert_eq!(total_lp, provider_lp + MIN_LIQUIDITY);
            }
        }
    }
}

#[test]
fn test_floor_price_negative_fails() {
    let (env, _ta, _tb, admin, client) = setup();
    let nft_collection = Address::generate(&env);
    client.initialize_nft(&admin, &_ta, &_tb, &nft_collection, &None);

    let result = client.try_update_floor_price(&admin, &-1);
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}

#[test]
fn test_multiple_swaps_accumulate_metrics() {
    let (env, ta, tb, _admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &1_000_000, &1_000_000, &1);

    // Multiple swaps in both directions
    for _ in 0..5 {
        client.swap(&provider, &ta, &10_000, &1);
        client.swap(&provider, &tb, &10_000, &1);
    }

    let (volume, fees) = client.get_pool_metrics();
    assert_eq!(volume, 100_000); // 10 swaps * 10_000
    assert!(fees > 0);
}

fn dynamic_config() -> DynamicFeeConfig {
    DynamicFeeConfig {
        min_fee_bps: 30,
        max_fee_bps: 500,
        volatility_multiplier_bps: 5_000,
        utilization_multiplier_bps: 1_000,
        ema_alpha_bps: 5_000,
        volatility_window: 3_600,
        max_price_impact_bps: 2_000,
    }
}

fn setup_dynamic() -> (Env, Address, Address, Address, AmmPoolClient<'static>) {
    let (env, token_a, token_b, admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &1_000_000, &1_000_000, &1);
    client.configure_dynamic_fees(&admin, &dynamic_config());
    (env, token_a, token_b, admin, client)
}

#[test]
fn test_fixed_fee_behavior_is_preserved_until_opt_in() {
    let (env, token_a, _token_b, _admin, client) = setup();
    let provider = Address::generate(&env);
    client.add_liquidity(&provider, &1_000_000, &1_000_000, &1);

    let quote = client.quote_dynamic_swap(&100_000, &token_a);
    assert_eq!(quote.fee_bps, 30);
    assert_eq!(quote.volatility_bps, 0);
    assert_eq!(client.get_amount_out(&100_000, &token_a), quote.amount_out);
    assert_eq!(client.get_dynamic_fee_config(), None);
}

#[test]
fn test_utilization_increases_effective_fee() {
    let (_env, token_a, _token_b, _admin, client) = setup_dynamic();
    let small = client.quote_dynamic_swap(&10_000, &token_a);
    let large = client.quote_dynamic_swap(&100_000, &token_a);

    assert!(large.utilization_bps > small.utilization_bps);
    assert!(large.fee_bps > small.fee_bps);
    assert_eq!(large.fee_bps, 120);
    assert_eq!(client.get_amount_out(&100_000, &token_a), large.amount_out);
}

#[test]
fn test_recent_price_volatility_increases_and_caps_fee() {
    let (env, token_a, _token_b, _admin, client) = setup_dynamic();
    let trader = Address::generate(&env);
    let first_quote = client.quote_dynamic_swap(&100_000, &token_a);
    client.swap(&trader, &token_a, &100_000, &1);

    let state = client.get_volatility_state();
    assert!(state.ema_volatility_bps > 0);
    let second_quote = client.quote_dynamic_swap(&100_000, &token_a);
    assert!(second_quote.fee_bps > first_quote.fee_bps);
    assert_eq!(second_quote.fee_bps, dynamic_config().max_fee_bps);
}

#[test]
fn test_volatility_decays_after_inactivity_window() {
    let (env, token_a, _token_b, _admin, client) = setup_dynamic();
    let trader = Address::generate(&env);
    client.swap(&trader, &token_a, &100_000, &1);
    let volatile_quote = client.quote_dynamic_swap(&10_000, &token_a);
    assert!(volatile_quote.volatility_bps > 0);

    env.ledger().with_mut(|ledger| ledger.timestamp += 3_600);
    let decayed_quote = client.quote_dynamic_swap(&10_000, &token_a);
    assert_eq!(decayed_quote.volatility_bps, 0);
    assert!(decayed_quote.fee_bps < volatile_quote.fee_bps);
}

#[test]
fn test_dynamic_price_impact_curve_rejects_oversized_swap() {
    let (env, token_a, _token_b, _admin, client) = setup_dynamic();
    let trader = Address::generate(&env);
    let quote = client.quote_dynamic_swap(&500_000, &token_a);
    assert!(quote.price_impact_bps > dynamic_config().max_price_impact_bps);
    assert_eq!(
        client.try_swap(&trader, &token_a, &500_000, &1),
        Err(Ok(Error::PriceImpactExceeded))
    );
    assert_eq!(client.get_reserves(), (1_000_000, 1_000_000));
}

#[test]
fn test_swap_with_limits_guards_fee_and_deadline() {
    let (env, token_a, _token_b, _admin, client) = setup_dynamic();
    let trader = Address::generate(&env);
    env.ledger().with_mut(|ledger| ledger.timestamp = 100);
    let quote = client.quote_dynamic_swap(&100_000, &token_a);
    let now = env.ledger().timestamp();

    assert_eq!(
        client.try_swap_with_limits(
            &trader,
            &token_a,
            &100_000,
            &1,
            &(quote.fee_bps - 1),
            &(now + 60),
        ),
        Err(Ok(Error::FeeLimitExceeded))
    );
    assert_eq!(
        client.try_swap_with_limits(&trader, &token_a, &100_000, &1, &quote.fee_bps, &(now - 1),),
        Err(Ok(Error::DeadlineExpired))
    );
    assert_eq!(
        client.swap_with_limits(
            &trader,
            &token_a,
            &100_000,
            &quote.amount_out,
            &quote.fee_bps,
            &(now + 60),
        ),
        quote.amount_out
    );
}

#[test]
fn test_actual_dynamic_fee_is_recorded_in_metrics() {
    let (env, token_a, _token_b, _admin, client) = setup_dynamic();
    let trader = Address::generate(&env);
    let quote = client.quote_dynamic_swap(&100_000, &token_a);
    client.swap(&trader, &token_a, &100_000, &1);
    let (volume, fees) = client.get_pool_metrics();
    assert_eq!(volume, 100_000);
    assert_eq!(fees, 100_000 * quote.fee_bps / 10_000);
}

#[test]
fn test_dynamic_configuration_requires_admin_and_valid_bounds() {
    let (env, _token_a, _token_b, admin, client) = setup();
    let non_admin = Address::generate(&env);
    assert_eq!(
        client.try_configure_dynamic_fees(&non_admin, &dynamic_config()),
        Err(Ok(Error::Unauthorized))
    );

    let mut invalid = dynamic_config();
    invalid.min_fee_bps = invalid.max_fee_bps + 1;
    assert_eq!(
        client.try_configure_dynamic_fees(&admin, &invalid),
        Err(Ok(Error::InvalidDynamicFeeConfig))
    );
}

#[test]
fn test_disabling_dynamic_fees_restores_base_fee() {
    let (_env, token_a, _token_b, admin, client) = setup_dynamic();
    assert!(client.quote_dynamic_swap(&100_000, &token_a).fee_bps > 30);
    client.disable_dynamic_fees(&admin);
    assert_eq!(client.quote_dynamic_swap(&100_000, &token_a).fee_bps, 30);
    assert_eq!(client.get_dynamic_fee_config(), None);
}

#[test]
fn test_initialize_rejects_invalid_fee_and_identical_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, AmmPool);
    let client = AmmPoolClient::new(&env, &id);
    let admin = Address::generate(&env);
    let token = Address::generate(&env);
    let other = Address::generate(&env);

    assert_eq!(
        client.try_initialize(&admin, &token, &other, &Some(10_000)),
        Err(Ok(Error::InvalidFee))
    );
    assert_eq!(
        client.try_initialize(&admin, &token, &token, &None),
        Err(Ok(Error::InvalidToken))
    );
}
