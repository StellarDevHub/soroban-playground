#![cfg(test)]

use super::{types::{Error, PolicyStatus, TriggerDirection}, ParametricInsurance, ParametricInsuranceClient};
use soroban_sdk::{testutils::{Address as _, Ledger}, Address, Env, String};

const PREMIUM: i128 = 10_000_000;
const COVERAGE: i128 = 1_000_000_000;
const TERM: u64 = 2_592_000; // 30 days
const THRESHOLD: i128 = 50_0000000; // 50.0 scaled ×10^7

fn setup() -> (Env, ParametricInsuranceClient<'static>, Address, Address, u32) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ParametricInsurance);
    let client = ParametricInsuranceClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    client.initialize(&admin);
    client.set_oracle(&admin, &oracle, &true);
    let product_id = client.create_product(
        &admin,
        &String::from_str(&env, "Drought Cover"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "RAINFALL_MM"),
        &THRESHOLD,
        &TriggerDirection::AtOrBelow,
        &TERM,
    );
    (env, client, admin, oracle, product_id)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin, ..) = setup();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, client, admin, ..) = setup();
    let result = client.try_initialize(&admin);
    assert!(matches!(result, Err(Ok(Error::AlreadyInitialized))));
}

// ── Product management ────────────────────────────────────────────────────────

#[test]
fn test_create_product_increments_count() {
    let (env, client, admin, oracle, _) = setup();
    let id2 = client.create_product(
        &admin,
        &String::from_str(&env, "Flood Cover"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "WATER_LEVEL_CM"),
        &100_0000000i128,
        &TriggerDirection::AtOrAbove,
        &TERM,
    );
    assert_eq!(id2, 2);
    assert_eq!(client.product_count(), 2);
}

#[test]
fn test_create_product_empty_name_fails() {
    let (env, client, admin, oracle, _) = setup();
    let result = client.try_create_product(
        &admin,
        &String::from_str(&env, ""),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "X"),
        &THRESHOLD,
        &TriggerDirection::AtOrBelow,
        &TERM,
    );
    assert!(matches!(result, Err(Ok(Error::EmptyName))));
}

#[test]
fn test_create_product_non_admin_fails() {
    let (env, client, _admin, oracle, _) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_create_product(
        &stranger,
        &String::from_str(&env, "X"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "X"),
        &THRESHOLD,
        &TriggerDirection::AtOrBelow,
        &TERM,
    );
    assert!(matches!(result, Err(Ok(Error::Unauthorized))));
}

// ── Policy purchase ───────────────────────────────────────────────────────────

#[test]
fn test_buy_policy_creates_active_policy() {
    let (env, client, _admin, _oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    assert_eq!(policy_id, 1);
    let policy = client.get_policy(&policy_id);
    assert_eq!(policy.holder, holder);
    assert_eq!(policy.status, PolicyStatus::Active);
    assert_eq!(policy.coverage_amount, COVERAGE);
}

#[test]
fn test_buy_policy_inactive_product_fails() {
    let (env, client, admin, _oracle, product_id) = setup();
    client.deactivate_product(&admin, &product_id);
    let holder = Address::generate(&env);
    let result = client.try_buy_policy(&holder, &product_id);
    assert!(matches!(result, Err(Ok(Error::ProductInactive))));
}

// ── Oracle submissions ────────────────────────────────────────────────────────

#[test]
fn test_submit_reading_unknown_oracle_fails() {
    let (env, client, ..) = setup();
    let stranger = Address::generate(&env);
    let result = client.try_submit_reading(
        &stranger,
        &String::from_str(&env, "RAINFALL_MM"),
        &30_0000000i128,
    );
    assert!(matches!(result, Err(Ok(Error::UnknownOracle))));
}

#[test]
fn test_submit_reading_stored_correctly() {
    let (env, client, _admin, oracle, _) = setup();
    client.submit_reading(&oracle, &String::from_str(&env, "RAINFALL_MM"), &30_0000000i128);
    let reading = client.get_reading(&oracle, &String::from_str(&env, "RAINFALL_MM")).unwrap();
    assert_eq!(reading.value, 30_0000000);
}

// ── Claim processing ──────────────────────────────────────────────────────────

#[test]
fn test_process_claim_trigger_met_pays_out() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);

    // Rainfall = 20mm, threshold = 50mm, direction = AtOrBelow → triggered
    client.submit_reading(&oracle, &String::from_str(&env, "RAINFALL_MM"), &20_0000000i128);

    let payout = client.process_claim(&policy_id);
    assert_eq!(payout, COVERAGE);

    let policy = client.get_policy(&policy_id);
    assert_eq!(policy.status, PolicyStatus::Claimed);
    assert_eq!(policy.payout_amount, Some(COVERAGE));
    assert_eq!(policy.trigger_value, Some(20_0000000i128));
}

#[test]
fn test_process_claim_trigger_not_met_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);

    // Rainfall = 80mm, threshold = 50mm, direction = AtOrBelow → not triggered
    client.submit_reading(&oracle, &String::from_str(&env, "RAINFALL_MM"), &80_0000000i128);

    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::TriggerNotMet))));
}

#[test]
fn test_process_claim_no_oracle_data_fails() {
    let (env, client, _admin, _oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::OracleDataStale))));
}

#[test]
fn test_process_claim_stale_oracle_data_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);

    client.submit_reading(&oracle, &String::from_str(&env, "RAINFALL_MM"), &20_0000000i128);

    // Advance past the 24h staleness window
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::OracleDataStale))));
}

#[test]
fn test_process_claim_double_claim_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    client.submit_reading(&oracle, &String::from_str(&env, "RAINFALL_MM"), &10_0000000i128);
    client.process_claim(&policy_id);
    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::PolicyAlreadyClaimed))));
}

#[test]
fn test_process_claim_expired_policy_fails() {
    let (env, client, _admin, oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    client.submit_reading(&oracle, &String::from_str(&env, "RAINFALL_MM"), &10_0000000i128);

    // Advance past policy term
    env.ledger().with_mut(|l| l.timestamp += TERM + 1);

    let result = client.try_process_claim(&policy_id);
    assert!(matches!(result, Err(Ok(Error::PolicyExpired))));
}

#[test]
fn test_at_or_above_trigger_fires_correctly() {
    let (env, client, admin, oracle, _) = setup();
    let flood_product = client.create_product(
        &admin,
        &String::from_str(&env, "Flood Cover"),
        &PREMIUM,
        &COVERAGE,
        &oracle,
        &String::from_str(&env, "WATER_LEVEL_CM"),
        &100_0000000i128,
        &TriggerDirection::AtOrAbove,
        &TERM,
    );
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &flood_product);

    // Water level = 150cm, threshold = 100cm, AtOrAbove → triggered
    client.submit_reading(&oracle, &String::from_str(&env, "WATER_LEVEL_CM"), &150_0000000i128);
    let payout = client.process_claim(&policy_id);
    assert_eq!(payout, COVERAGE);
}

#[test]
fn test_expire_policy_after_term() {
    let (env, client, _admin, _oracle, product_id) = setup();
    let holder = Address::generate(&env);
    let policy_id = client.buy_policy(&holder, &product_id);
    env.ledger().with_mut(|l| l.timestamp += TERM + 1);
    client.expire_policy(&policy_id);
    let policy = client.get_policy(&policy_id);
    assert_eq!(policy.status, PolicyStatus::Expired);
}
