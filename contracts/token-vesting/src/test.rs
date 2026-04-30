#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, Vec,
};

use crate::{TokenVesting, TokenVestingClient};
use crate::types::{Error, VestingType};

// ── Helpers ───────────────────────────────────────────────────────────────────

struct Setup<'a> {
    env: Env,
    admin: Address,
    client: TokenVestingClient<'a>,
    token: Address,
    token_client: TokenClient<'a>,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TokenVesting);
    let client = TokenVestingClient::new(&env, &contract_id);

    // Deploy a test SAC token
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_addr = token.address();
    let sac = StellarAssetClient::new(&env, &token_addr);
    let token_client = TokenClient::new(&env, &token_addr);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Mint tokens to admin for use in tests
    sac.mint(&admin, &1_000_000i128);

    Setup { env, admin, client, token: token_addr, token_client }
}

fn set_time(env: &Env, ts: u64) {
    env.ledger().with_mut(|l| l.timestamp = ts);
}

// ── Initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let s = setup();
    assert!(s.client.is_initialized());
}

#[test]
fn test_double_initialize_fails() {
    let s = setup();
    let result = s.client.try_initialize(&s.admin);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

// ── Linear vesting ────────────────────────────────────────────────────────────

#[test]
fn test_create_linear_schedule() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = s.client.create_linear_schedule(
        &s.admin,
        &beneficiary,
        &s.token,
        &10_000i128,
        &2000u64, // cliff at t=2000
        &1000u64, // start at t=1000
        &5000u64, // end at t=5000
    );
    assert_eq!(id, 1);
    assert_eq!(s.client.schedule_count(), 1);

    let schedule = s.client.get_schedule(&id);
    assert_eq!(schedule.total_amount, 10_000);
    assert_eq!(schedule.released_amount, 0);
    assert!(!schedule.revoked);
    assert_eq!(schedule.vesting_type, VestingType::Linear);
}

#[test]
fn test_linear_cliff_not_reached() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = s.client.create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &2000u64, &1000u64, &5000u64,
    );

    // Still before cliff
    set_time(&s.env, 1500);
    let result = s.client.try_release(&id);
    assert_eq!(result, Err(Ok(Error::CliffNotReached)));
}

#[test]
fn test_linear_partial_release_at_midpoint() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = s.client.create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &2000u64, &1000u64, &4000u64, // cliff=2000, end=4000 → duration=2000
    );

    // At t=3000: elapsed=1000/2000 → 50% vested = 5000
    set_time(&s.env, 3000);
    let releasable = s.client.releasable_amount(&id);
    assert_eq!(releasable, 5_000);

    let released = s.client.release(&id);
    assert_eq!(released, 5_000);
    assert_eq!(s.token_client.balance(&beneficiary), 5_000);
}

#[test]
fn test_linear_full_release_after_end() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = s.client.create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &2000u64, &1000u64, &4000u64,
    );

    set_time(&s.env, 5000); // past end
    let released = s.client.release(&id);
    assert_eq!(released, 10_000);
    assert_eq!(s.token_client.balance(&beneficiary), 10_000);
}

#[test]
fn test_linear_nothing_to_release_twice() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = s.client.create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &2000u64, &1000u64, &4000u64,
    );

    set_time(&s.env, 5000);
    s.client.release(&id);

    let result = s.client.try_release(&id);
    assert_eq!(result, Err(Ok(Error::NothingToRelease)));
}

#[test]
fn test_linear_invalid_schedule_params() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    // cliff before start
    let result = s.client.try_create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &500u64, &1000u64, &4000u64,
    );
    assert_eq!(result, Err(Ok(Error::InvalidSchedule)));
}

// ── Milestone vesting ─────────────────────────────────────────────────────────

fn make_milestone_schedule(s: &Setup, beneficiary: &Address) -> u32 {
    let mut hashes = Vec::new(&s.env);
    hashes.push_back(1u64);
    hashes.push_back(2u64);
    hashes.push_back(3u64);

    let mut bps = Vec::new(&s.env);
    bps.push_back(3000u32); // 30%
    bps.push_back(3000u32); // 30%
    bps.push_back(4000u32); // 40%

    s.client.create_milestone_schedule(
        &s.admin, beneficiary, &s.token, &10_000i128,
        &2000u64, &hashes, &bps,
    )
}

#[test]
fn test_milestone_schedule_created() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = make_milestone_schedule(&s, &beneficiary);
    let schedule = s.client.get_schedule(&id);
    assert_eq!(schedule.vesting_type, VestingType::Milestone);
    assert_eq!(schedule.milestones.len(), 3);
}

#[test]
fn test_milestone_bps_must_sum_to_10000() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let mut hashes = Vec::new(&s.env);
    hashes.push_back(1u64);
    let mut bps = Vec::new(&s.env);
    bps.push_back(5000u32); // only 50%, not 100%

    let result = s.client.try_create_milestone_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &2000u64, &hashes, &bps,
    );
    assert_eq!(result, Err(Ok(Error::InvalidSchedule)));
}

#[test]
fn test_approve_and_release_milestone() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = make_milestone_schedule(&s, &beneficiary);

    // Approve milestone 0 (30%)
    set_time(&s.env, 2500); // past cliff
    s.client.approve_milestone(&id, &0u32);

    let releasable = s.client.releasable_amount(&id);
    assert_eq!(releasable, 3_000); // 30% of 10_000

    let released = s.client.release(&id);
    assert_eq!(released, 3_000);
    assert_eq!(s.token_client.balance(&beneficiary), 3_000);
}

#[test]
fn test_approve_multiple_milestones_then_release() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = make_milestone_schedule(&s, &beneficiary);
    set_time(&s.env, 2500);

    s.client.approve_milestone(&id, &0u32);
    s.client.approve_milestone(&id, &1u32);

    let released = s.client.release(&id);
    assert_eq!(released, 6_000); // 30% + 30%
}

#[test]
fn test_double_approve_fails() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = make_milestone_schedule(&s, &beneficiary);
    set_time(&s.env, 2500);
    s.client.approve_milestone(&id, &0u32);

    let result = s.client.try_approve_milestone(&id, &0u32);
    assert_eq!(result, Err(Ok(Error::MilestoneAlreadyApproved)));
}

#[test]
fn test_milestone_cliff_not_reached() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = make_milestone_schedule(&s, &beneficiary);
    s.client.approve_milestone(&id, &0u32);

    // Still before cliff
    set_time(&s.env, 1500);
    let result = s.client.try_release(&id);
    assert_eq!(result, Err(Ok(Error::CliffNotReached)));
}

// ── Revoke ────────────────────────────────────────────────────────────────────

#[test]
fn test_revoke_linear_returns_unvested() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = s.client.create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &2000u64, &1000u64, &4000u64,
    );

    // At t=3000: 50% vested → admin gets back 5000
    set_time(&s.env, 3000);
    let returned = s.client.revoke(&id);
    assert_eq!(returned, 5_000);
    assert_eq!(s.token_client.balance(&beneficiary), 5_000);

    // Schedule is now revoked
    let result = s.client.try_release(&id);
    assert_eq!(result, Err(Ok(Error::ScheduleRevoked)));
}

#[test]
fn test_double_revoke_fails() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let id = s.client.create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &10_000i128,
        &2000u64, &1000u64, &4000u64,
    );

    set_time(&s.env, 3000);
    s.client.revoke(&id);
    let result = s.client.try_revoke(&id);
    assert_eq!(result, Err(Ok(Error::AlreadyRevoked)));
}

#[test]
fn test_zero_amount_fails() {
    let s = setup();
    let beneficiary = Address::generate(&s.env);
    set_time(&s.env, 1000);

    let result = s.client.try_create_linear_schedule(
        &s.admin, &beneficiary, &s.token, &0i128,
        &2000u64, &1000u64, &4000u64,
    );
    assert_eq!(result, Err(Ok(Error::ZeroAmount)));
}
