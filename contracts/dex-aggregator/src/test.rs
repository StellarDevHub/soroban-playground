#![cfg(test)]

use super::{types::Error, DexAggregatorContract, DexAggregatorContractClient};
use soroban_sdk::{testutils::Address as _, vec, Address, Env, String, Vec};

fn setup() -> (Env, DexAggregatorContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, DexAggregatorContract);
    let client = DexAggregatorContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin, &3u32, &10u32); // max 3 hops, 0.1% protocol fee

    (env, client, admin)
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

fn add_usdc_xlm_pool(
    env: &Env,
    client: &DexAggregatorContractClient,
    admin: &Address,
) -> u32 {
    client.add_pool(
        admin,
        &s(env, "USDC/XLM"),
        &s(env, "USDC"),
        &s(env, "XLM"),
        &1_000_000i128,
        &5_000_000i128,
        &30u32,
    )
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
    assert_eq!(client.get_max_hops(), 3);
    assert_eq!(client.get_protocol_fee_bps(), 10);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin) = setup();
    let result = client.try_initialize(&admin, &3u32, &10u32);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

#[test]
fn test_initialize_invalid_fee_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, DexAggregatorContract);
    let client = DexAggregatorContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let result = client.try_initialize(&admin, &3u32, &1_001u32);
    assert!(matches!(result, Err(Ok(Error::InvalidFee))));
}

// ── Pool management ───────────────────────────────────────────────────────────

#[test]
fn test_add_pool_stores_data() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    assert_eq!(id, 1);
    assert_eq!(client.pool_count(), 1);

    let pool = client.get_pool(&id);
    assert_eq!(pool.token_a, s(&env, "USDC"));
    assert_eq!(pool.token_b, s(&env, "XLM"));
    assert_eq!(pool.fee_bps, 30);
    assert!(pool.is_active);
}

#[test]
fn test_add_pool_sequential_ids() {
    let (env, client, admin) = setup();
    let id1 = add_usdc_xlm_pool(&env, &client, &admin);
    let id2 = client.add_pool(
        &admin,
        &s(&env, "ETH/XLM"),
        &s(&env, "ETH"),
        &s(&env, "XLM"),
        &500_000i128,
        &2_000_000i128,
        &50u32,
    );
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

#[test]
fn test_add_pool_empty_name_fails() {
    let (env, client, admin) = setup();
    let result = client.try_add_pool(
        &admin,
        &s(&env, ""),
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &1_000_000i128,
        &5_000_000i128,
        &30u32,
    );
    assert!(matches!(result, Err(Ok(Error::EmptyName))));
}

#[test]
fn test_add_pool_zero_liquidity_fails() {
    let (env, client, admin) = setup();
    let result = client.try_add_pool(
        &admin,
        &s(&env, "USDC/XLM"),
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &0i128,
        &5_000_000i128,
        &30u32,
    );
    assert!(matches!(result, Err(Ok(Error::ZeroLiquidity))));
}

#[test]
fn test_add_pool_invalid_fee_fails() {
    let (env, client, admin) = setup();
    let result = client.try_add_pool(
        &admin,
        &s(&env, "USDC/XLM"),
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &1_000_000i128,
        &5_000_000i128,
        &1_001u32,
    );
    assert!(matches!(result, Err(Ok(Error::InvalidFee))));
}

#[test]
fn test_non_admin_cannot_add_pool() {
    let (env, client, _admin) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_add_pool(
        &stranger,
        &s(&env, "USDC/XLM"),
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &1_000_000i128,
        &5_000_000i128,
        &30u32,
    );
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

#[test]
fn test_set_pool_active_deactivates() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    client.set_pool_active(&admin, &id, &false);
    assert!(!client.get_pool(&id).is_active);
}

// ── Price quotes ──────────────────────────────────────────────────────────────

#[test]
fn test_get_quotes_returns_direct_pools() {
    let (env, client, admin) = setup();
    add_usdc_xlm_pool(&env, &client, &admin);

    let quotes = client.get_quotes(&s(&env, "USDC"), &s(&env, "XLM"), &100_000i128);
    assert_eq!(quotes.len(), 1);
    assert!(quotes.get(0).unwrap().amount_out > 0);
}

#[test]
fn test_get_quotes_reverse_direction() {
    let (env, client, admin) = setup();
    add_usdc_xlm_pool(&env, &client, &admin);

    let quotes = client.get_quotes(&s(&env, "XLM"), &s(&env, "USDC"), &500_000i128);
    assert_eq!(quotes.len(), 1);
    assert!(quotes.get(0).unwrap().amount_out > 0);
}

#[test]
fn test_get_quotes_inactive_pool_excluded() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    client.set_pool_active(&admin, &id, &false);

    let quotes = client.get_quotes(&s(&env, "USDC"), &s(&env, "XLM"), &100_000i128);
    assert_eq!(quotes.len(), 0);
}

#[test]
fn test_get_quotes_zero_amount_fails() {
    let (env, client, _admin) = setup();
    let result = client.try_get_quotes(&s(&env, "USDC"), &s(&env, "XLM"), &0i128);
    assert!(matches!(result, Err(Ok(Error::ZeroAmount))));
}

// ── Route finding ─────────────────────────────────────────────────────────────

#[test]
fn test_find_best_route_direct() {
    let (env, client, admin) = setup();
    add_usdc_xlm_pool(&env, &client, &admin);

    let route = client.find_best_route(&s(&env, "USDC"), &s(&env, "XLM"), &100_000i128);
    assert_eq!(route.hops.len(), 1);
    assert!(route.estimated_out > 0);
}

#[test]
fn test_find_best_route_two_hop() {
    let (env, client, admin) = setup();
    // USDC → XLM pool
    add_usdc_xlm_pool(&env, &client, &admin);
    // XLM → ETH pool
    client.add_pool(
        &admin,
        &s(&env, "XLM/ETH"),
        &s(&env, "XLM"),
        &s(&env, "ETH"),
        &10_000_000i128,
        &1_000_000i128,
        &30u32,
    );

    // USDC → ETH should find 2-hop route via XLM
    let route = client.find_best_route(&s(&env, "USDC"), &s(&env, "ETH"), &100_000i128);
    assert_eq!(route.hops.len(), 2);
    assert!(route.estimated_out > 0);
}

#[test]
fn test_find_best_route_no_route_fails() {
    let (env, client, _admin) = setup();
    let result = client.try_find_best_route(&s(&env, "USDC"), &s(&env, "ETH"), &100_000i128);
    assert!(matches!(result, Err(Ok(Error::NoRouteFound))));
}

#[test]
fn test_find_best_route_prefers_higher_output() {
    let (env, client, admin) = setup();
    // Low-fee pool
    client.add_pool(
        &admin,
        &s(&env, "USDC/XLM low"),
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &1_000_000i128,
        &5_000_000i128,
        &10u32,
    );
    // High-fee pool
    client.add_pool(
        &admin,
        &s(&env, "USDC/XLM high"),
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &1_000_000i128,
        &5_000_000i128,
        &300u32,
    );

    let route = client.find_best_route(&s(&env, "USDC"), &s(&env, "XLM"), &100_000i128);
    // Should pick pool 1 (lower fee → higher output)
    assert_eq!(route.hops.get(0).unwrap().pool_id, 1);
}

// ── Swap ──────────────────────────────────────────────────────────────────────

#[test]
fn test_swap_direct_succeeds() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    let user = Address::generate(&env);

    let hop = crate::types::RouteHop {
        pool_id: id,
        token_in: s(&env, "USDC"),
        token_out: s(&env, "XLM"),
    };
    let hops = vec![&env, hop];

    let result = client.swap(&user, &hops, &100_000i128, &1i128);
    assert!(result.amount_out > 0);
    assert_eq!(result.amount_in, 100_000);
}

#[test]
fn test_swap_updates_pool_reserves() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    let user = Address::generate(&env);

    let pool_before = client.get_pool(&id);
    let hop = crate::types::RouteHop {
        pool_id: id,
        token_in: s(&env, "USDC"),
        token_out: s(&env, "XLM"),
    };
    client.swap(&user, &vec![&env, hop], &100_000i128, &1i128);

    let pool_after = client.get_pool(&id);
    assert!(pool_after.reserve_a > pool_before.reserve_a); // USDC in
    assert!(pool_after.reserve_b < pool_before.reserve_b); // XLM out
    assert_eq!(pool_after.swap_count, 1);
}

#[test]
fn test_swap_slippage_exceeded_fails() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    let user = Address::generate(&env);

    let hop = crate::types::RouteHop {
        pool_id: id,
        token_in: s(&env, "USDC"),
        token_out: s(&env, "XLM"),
    };
    // Demand impossibly high output
    let result = client.try_swap(&user, &vec![&env, hop], &100_000i128, &999_999_999i128);
    assert!(matches!(result, Err(Ok(Error::SlippageExceeded))));
}

#[test]
fn test_swap_zero_amount_fails() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    let user = Address::generate(&env);

    let hop = crate::types::RouteHop {
        pool_id: id,
        token_in: s(&env, "USDC"),
        token_out: s(&env, "XLM"),
    };
    let result = client.try_swap(&user, &vec![&env, hop], &0i128, &0i128);
    assert!(matches!(result, Err(Ok(Error::ZeroAmount))));
}

#[test]
fn test_swap_empty_route_fails() {
    let (env, client, _admin) = setup();
    let user = Address::generate(&env);
    let empty: Vec<crate::types::RouteHop> = Vec::new(&env);
    let result = client.try_swap(&user, &empty, &100_000i128, &1i128);
    assert!(matches!(result, Err(Ok(Error::EmptyRoute))));
}

#[test]
fn test_swap_inactive_pool_fails() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    client.set_pool_active(&admin, &id, &false);
    let user = Address::generate(&env);

    let hop = crate::types::RouteHop {
        pool_id: id,
        token_in: s(&env, "USDC"),
        token_out: s(&env, "XLM"),
    };
    let result = client.try_swap(&user, &vec![&env, hop], &100_000i128, &1i128);
    assert!(matches!(result, Err(Ok(Error::PoolInactive))));
}

#[test]
fn test_swap_invalid_hop_fails() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    let user = Address::generate(&env);

    // Wrong token direction for this pool
    let hop = crate::types::RouteHop {
        pool_id: id,
        token_in: s(&env, "ETH"),
        token_out: s(&env, "BTC"),
    };
    let result = client.try_swap(&user, &vec![&env, hop], &100_000i128, &1i128);
    assert!(matches!(result, Err(Ok(Error::InvalidHop))));
}

#[test]
fn test_swap_tracks_user_volume() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    let user = Address::generate(&env);

    let hop = crate::types::RouteHop {
        pool_id: id,
        token_in: s(&env, "USDC"),
        token_out: s(&env, "XLM"),
    };
    client.swap(&user, &vec![&env, hop.clone()], &100_000i128, &1i128);
    client.swap(&user, &vec![&env, hop], &50_000i128, &1i128);

    assert_eq!(client.get_user_volume(&user), 150_000);
}

#[test]
fn test_swap_best_route_executes() {
    let (env, client, admin) = setup();
    add_usdc_xlm_pool(&env, &client, &admin);
    let user = Address::generate(&env);

    let result = client.swap_best_route(
        &user,
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &100_000i128,
        &1i128,
    );
    assert!(result.amount_out > 0);
}

#[test]
fn test_protocol_fee_accrues() {
    let (env, client, admin) = setup();
    // Large reserves so a 10_000 swap has negligible price impact
    client.add_pool(
        &admin,
        &s(&env, "USDC/XLM big"),
        &s(&env, "USDC"),
        &s(&env, "XLM"),
        &100_000_000i128,
        &500_000_000i128,
        &30u32,
    );
    let user = Address::generate(&env);

    let hop = crate::types::RouteHop {
        pool_id: 1,
        token_in: s(&env, "USDC"),
        token_out: s(&env, "XLM"),
    };
    client.swap(&user, &vec![&env, hop], &10_000i128, &1i128);

    assert!(client.get_protocol_fee_accrued() > 0);
}

#[test]
fn test_update_reserves_changes_pool() {
    let (env, client, admin) = setup();
    let id = add_usdc_xlm_pool(&env, &client, &admin);
    client.update_reserves(&admin, &id, &2_000_000i128, &10_000_000i128);
    let pool = client.get_pool(&id);
    assert_eq!(pool.reserve_a, 2_000_000);
    assert_eq!(pool.reserve_b, 10_000_000);
}
