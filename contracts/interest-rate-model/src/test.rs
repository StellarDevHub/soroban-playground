#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger as _}, vec, Address, Env, Vec};
use crate::types::{CurveType, RateTier};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, InterestRateModelClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, InterestRateModel);
    let client = InterestRateModelClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

/// Build `count` strictly-ascending tiers (threshold_bps = i*400, i in 1..=count).
fn make_ascending_tiers(env: &Env, count: u32) -> Vec<RateTier> {
    let mut tiers = Vec::new(env);
    for i in 1..=count {
        tiers.push_back(RateTier { threshold_bps: i * 400, rate_bps: i * 50 });
    }
    tiers
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);
    assert!(client.get_config().is_some());
}

#[test]
#[should_panic]
fn test_double_initialize_panics() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);
}

#[test]
fn test_get_config_returns_none_before_init() {
    let (_, _, client) = setup();
    assert!(client.get_config().is_none());
}

#[test]
fn test_get_config_matches_init_params_linear() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);
    let cfg = client.get_config().unwrap();
    assert_eq!(cfg.base_rate_bps, 500);
    assert_eq!(cfg.multiplier_bps, 2000);
    assert_eq!(cfg.max_rate_bps, 10_000);
    assert_eq!(cfg.curve_type, CurveType::Linear);
}

#[test]
fn test_get_config_matches_init_params_exponential() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &300u32, &1500u32, &8000u32, &CurveType::Exponential);
    let cfg = client.get_config().unwrap();
    assert_eq!(cfg.base_rate_bps, 300);
    assert_eq!(cfg.multiplier_bps, 1500);
    assert_eq!(cfg.max_rate_bps, 8000);
    assert_eq!(cfg.curve_type, CurveType::Exponential);
}

#[test]
fn test_last_update_zero_before_init() {
    let (_, _, client) = setup();
    assert_eq!(client.last_update(), 0);
}

#[test]
fn test_last_update_set_on_initialize() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);
    assert_eq!(client.last_update(), env.ledger().timestamp());
}

// ── Rate Computation — Linear ─────────────────────────────────────────────────

#[test]
fn test_compute_rate_linear_zero_utilization() {
    let (_, admin, client) = setup();
    // base=500; with 0 utilization only the base rate applies
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);
    let r = client.compute_rate(&0i128, &1000i128);
    assert_eq!(r.utilization_bps, 0);
    assert_eq!(r.current_rate_bps, 500);
}

#[test]
fn test_compute_rate_linear_half_utilization() {
    let (_, admin, client) = setup();
    // base=0, multiplier=10000: rate = 0 + (5000 * 10000 / 10000) = 5000
    client.initialize(&admin, &0u32, &10_000u32, &10_000u32, &CurveType::Linear);
    let r = client.compute_rate(&500i128, &1000i128);
    assert_eq!(r.utilization_bps, 5000);
    assert_eq!(r.current_rate_bps, 5000);
}

#[test]
fn test_compute_rate_linear_full_utilization() {
    let (_, admin, client) = setup();
    // 100% util: rate = 0 + (10000 * 10000 / 10000) = 10000, at max exactly
    client.initialize(&admin, &0u32, &10_000u32, &10_000u32, &CurveType::Linear);
    let r = client.compute_rate(&1000i128, &1000i128);
    assert_eq!(r.utilization_bps, 10000);
    assert_eq!(r.current_rate_bps, 10000);
}

#[test]
fn test_compute_rate_linear_nonzero_base() {
    let (_, admin, client) = setup();
    // base=500, multiplier=1000
    // 50% util: rate = 500 + (5000 * 1000 / 10000) = 500 + 500 = 1000
    client.initialize(&admin, &500u32, &1000u32, &10_000u32, &CurveType::Linear);
    let r = client.compute_rate(&500i128, &1000i128);
    assert_eq!(r.utilization_bps, 5000);
    assert_eq!(r.current_rate_bps, 1000);
}

#[test]
fn test_compute_rate_linear_quarter_utilization() {
    let (_, admin, client) = setup();
    // base=200, multiplier=2000
    // 25% util: rate = 200 + (2500 * 2000 / 10000) = 200 + 500 = 700
    client.initialize(&admin, &200u32, &2000u32, &10_000u32, &CurveType::Linear);
    let r = client.compute_rate(&250i128, &1000i128);
    assert_eq!(r.utilization_bps, 2500);
    assert_eq!(r.current_rate_bps, 700);
}

#[test]
fn test_compute_rate_zero_total_available() {
    let (_, admin, client) = setup();
    // total_available == 0 → utilization is 0, rate equals base rate
    client.initialize(&admin, &50u32, &1000u32, &5000u32, &CurveType::Linear);
    let r = client.compute_rate(&100i128, &0i128);
    assert_eq!(r.utilization_bps, 0);
    assert_eq!(r.current_rate_bps, 50);
}

#[test]
fn test_compute_rate_borrowed_exceeds_available() {
    let (_, admin, client) = setup();
    // base=0, multiplier=10000, max=10000
    // borrowed=1500, total=1000 → util = (1500*10000)/1000 = 15000 bps
    // rate = 15000 → capped at max 10000
    client.initialize(&admin, &0u32, &10_000u32, &10_000u32, &CurveType::Linear);
    let r = client.compute_rate(&1500i128, &1000i128);
    assert_eq!(r.utilization_bps, 15000);
    assert_eq!(r.current_rate_bps, 10000);
}

#[test]
fn test_rate_cap_linear() {
    let (_, admin, client) = setup();
    // very large multiplier with low max to force cap
    client.initialize(&admin, &0u32, &50_000u32, &200u32, &CurveType::Linear);
    let r = client.compute_rate(&900i128, &1000i128);
    assert_eq!(r.utilization_bps, 9000);
    assert!(r.current_rate_bps <= 200);
}

#[test]
fn test_rate_equals_base_when_multiplier_is_zero() {
    let (_, admin, client) = setup();
    // multiplier=0: rate always equals base regardless of utilization
    client.initialize(&admin, &5000u32, &0u32, &5000u32, &CurveType::Linear);
    let r = client.compute_rate(&1000i128, &1000i128);
    assert_eq!(r.current_rate_bps, 5000);
}

// ── Rate Computation — Exponential ────────────────────────────────────────────

#[test]
fn test_compute_rate_exponential_zero_utilization() {
    let (_, admin, client) = setup();
    // util=0, util_sq=0 → rate = base = 100
    client.initialize(&admin, &100u32, &2000u32, &5000u32, &CurveType::Exponential);
    let r = client.compute_rate(&0i128, &1000i128);
    assert_eq!(r.utilization_bps, 0);
    assert_eq!(r.current_rate_bps, 100);
}

#[test]
fn test_compute_rate_exponential_75pct() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &100u32, &2000u32, &5000u32, &CurveType::Exponential);
    // util_bps=7500, util_sq = 7500*7500/10000 = 5625
    // rate = 100 + (5625 * 2000 / 10000) = 100 + 1125 = 1225
    let r = client.compute_rate(&75i128, &100i128);
    assert_eq!(r.utilization_bps, 7500);
    assert_eq!(r.current_rate_bps, 1225);
}

#[test]
fn test_compute_rate_exponential_full_utilization() {
    let (_, admin, client) = setup();
    // high max to avoid cap
    // util_bps=10000, util_sq = 10000*10000/10000 = 10000
    // rate = 100 + (10000 * 10000 / 10000) = 100 + 10000 = 10100
    client.initialize(&admin, &100u32, &10_000u32, &50_000u32, &CurveType::Exponential);
    let r = client.compute_rate(&1000i128, &1000i128);
    assert_eq!(r.utilization_bps, 10000);
    assert_eq!(r.current_rate_bps, 10100);
}

#[test]
fn test_rate_cap_exponential() {
    let (_, admin, client) = setup();
    // low max to force cap
    client.initialize(&admin, &0u32, &50_000u32, &500u32, &CurveType::Exponential);
    // 80% util → util_sq=6400; rate = 6400*50000/10000 = 32000 → capped at 500
    let r = client.compute_rate(&800i128, &1000i128);
    assert!(r.current_rate_bps <= 500);
}

#[test]
fn test_exponential_rate_lower_than_linear_below_full_utilization() {
    // The exponential implementation uses util_sq = u²/10000, so for util<10000
    // the effective multiplier (util_sq/10000) is always less than the linear (util/10000).
    // Example at 50% util (bps=5000), mult=5000, base=0:
    //   Linear:  rate = 5000*5000/10000 = 2500
    //   Exp:     util_sq=2500, rate = 2500*5000/10000 = 1250
    let env = Env::default();
    env.mock_all_auths();

    let lin_id = env.register_contract(None, InterestRateModel);
    let lin = InterestRateModelClient::new(&env, &lin_id);
    let admin_l = Address::generate(&env);
    lin.initialize(&admin_l, &0u32, &5000u32, &100_000u32, &CurveType::Linear);

    let exp_id = env.register_contract(None, InterestRateModel);
    let exp = InterestRateModelClient::new(&env, &exp_id);
    let admin_e = Address::generate(&env);
    exp.initialize(&admin_e, &0u32, &5000u32, &100_000u32, &CurveType::Exponential);

    let rl = lin.compute_rate(&500i128, &1000i128); // 50% util
    let re = exp.compute_rate(&500i128, &1000i128); // 50% util

    assert_eq!(rl.current_rate_bps, 2500);
    assert_eq!(re.current_rate_bps, 1250);
    assert!(rl.current_rate_bps > re.current_rate_bps);
}

// ── RateQuery — projected field ───────────────────────────────────────────────

#[test]
fn test_compute_rate_projected_is_always_none() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &500u32, &1000u32, &5000u32, &CurveType::Linear);
    let r = client.compute_rate(&500i128, &1000i128);
    assert!(r.projected_rate_bps.is_none());
}

// ── last_update tracking ──────────────────────────────────────────────────────

#[test]
fn test_last_update_advances_after_compute_rate() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);

    env.ledger().with_mut(|l| { l.timestamp = 999; });
    client.compute_rate(&500i128, &1000i128);
    assert_eq!(client.last_update(), 999);
}

#[test]
fn test_last_update_monotonically_increases() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &500u32, &2000u32, &10_000u32, &CurveType::Linear);

    env.ledger().with_mut(|l| { l.timestamp = 100; });
    client.compute_rate(&500i128, &1000i128);
    let t1 = client.last_update();

    env.ledger().with_mut(|l| { l.timestamp = 200; });
    client.compute_rate(&500i128, &1000i128);
    let t2 = client.last_update();

    assert!(t2 > t1);
    assert_eq!(t2, 200);
}

// ── Multiple compute_rate calls ───────────────────────────────────────────────

#[test]
fn test_multiple_compute_rate_calls_return_independent_results() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &0u32, &10_000u32, &10_000u32, &CurveType::Linear);

    let r1 = client.compute_rate(&250i128, &1000i128); // 25%
    let r2 = client.compute_rate(&500i128, &1000i128); // 50%
    let r3 = client.compute_rate(&750i128, &1000i128); // 75%

    assert_eq!(r1.utilization_bps, 2500);
    assert_eq!(r2.utilization_bps, 5000);
    assert_eq!(r3.utilization_bps, 7500);
    // rate must be strictly increasing with utilization when below cap
    assert!(r1.current_rate_bps < r2.current_rate_bps);
    assert!(r2.current_rate_bps < r3.current_rate_bps);
}

#[test]
fn test_repeated_same_inputs_produce_same_rate() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &500u32, &1000u32, &5000u32, &CurveType::Linear);

    let r1 = client.compute_rate(&400i128, &1000i128);
    let r2 = client.compute_rate(&400i128, &1000i128);
    assert_eq!(r1.current_rate_bps, r2.current_rate_bps);
    assert_eq!(r1.utilization_bps, r2.utilization_bps);
}

// ── Tiered Rates ──────────────────────────────────────────────────────────────

#[test]
fn test_set_tiered_rates_valid() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &100u32, &1000u32, &5000u32, &CurveType::Linear);
    let tiers = vec![&env,
        RateTier { threshold_bps: 2500, rate_bps: 200 },
        RateTier { threshold_bps: 5000, rate_bps: 400 },
    ];
    client.set_tiered_rates(&admin, &tiers);
    // base config is unaffected by setting tiers
    assert_eq!(client.get_config().unwrap().base_rate_bps, 100);
}

#[test]
fn test_set_tiers_single_tier_valid() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &100u32, &1000u32, &5000u32, &CurveType::Linear);
    let tiers = vec![&env, RateTier { threshold_bps: 5000, rate_bps: 300 }];
    client.set_tiered_rates(&admin, &tiers);
    assert!(client.get_config().is_some());
}

#[test]
fn test_set_tiers_exactly_20_valid() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &50u32, &100u32, &5000u32, &CurveType::Linear);
    let tiers = make_ascending_tiers(&env, 20);
    client.set_tiered_rates(&admin, &tiers);
    assert!(client.get_config().is_some());
}

#[test]
#[should_panic]
fn test_set_tiers_too_many_panics() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &50u32, &100u32, &5000u32, &CurveType::Linear);
    let tiers = make_ascending_tiers(&env, 21);
    client.set_tiered_rates(&admin, &tiers);
}

#[test]
#[should_panic]
fn test_set_tiers_descending_thresholds_panics() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &100u32, &1000u32, &5000u32, &CurveType::Linear);
    let tiers = vec![&env,
        RateTier { threshold_bps: 5000, rate_bps: 200 },
        RateTier { threshold_bps: 4000, rate_bps: 400 },
    ];
    client.set_tiered_rates(&admin, &tiers);
}

#[test]
#[should_panic]
fn test_set_tiers_duplicate_threshold_panics() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &100u32, &1000u32, &5000u32, &CurveType::Linear);
    // second tier has the same threshold as the first → not strictly ascending
    let tiers = vec![&env,
        RateTier { threshold_bps: 3000, rate_bps: 200 },
        RateTier { threshold_bps: 3000, rate_bps: 400 },
    ];
    client.set_tiered_rates(&admin, &tiers);
}

#[test]
#[should_panic]
fn test_set_tiers_zero_threshold_panics() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &100u32, &1000u32, &5000u32, &CurveType::Linear);
    // threshold_bps == 0 == prev(0) → not strictly ascending
    let tiers = vec![&env, RateTier { threshold_bps: 0, rate_bps: 200 }];
    client.set_tiered_rates(&admin, &tiers);
}

#[test]
#[should_panic]
fn test_compute_rate_panics_before_init() {
    // compute_rate calls get_config().expect("Not initialized") — panics when not yet initialized.
    let (_, _, client) = setup();
    client.compute_rate(&500i128, &1000i128);
}
