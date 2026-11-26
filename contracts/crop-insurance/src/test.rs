#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String,
};

struct Fixture {
    env: Env,
    client: CropInsuranceClient<'static>,
    admin: Address,
    oracle: Address,
    token_id: Address,
}

impl Fixture {
    fn new(pool_funding: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let oracle = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin);
        let token_id = token_contract.address();
        let token_admin_client = token::StellarAssetClient::new(&env, &token_id);

        let insurance_id = env.register_contract(None, CropInsurance);
        token_admin_client.mint(&insurance_id, &pool_funding);

        let client = CropInsuranceClient::new(&env, &insurance_id);
        client.initialize(&admin, &oracle, &token_id);

        Self {
            env,
            client,
            admin,
            oracle,
            token_id,
        }
    }

    fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.token_id).mint(to, &amount);
    }

    fn balance(&self, who: &Address) -> i128 {
        token::Client::new(&self.env, &self.token_id).balance(who)
    }

    fn create(&self, farmer: &Address, region: &str, premium: i128, payout: i128) -> u64 {
        self.client.create_policy(
            farmer,
            &String::from_str(&self.env, region),
            &50,
            &true,
            &premium,
            &payout,
            &86_400,
        )
    }

    fn rain(&self, region: &str, rainfall_mm: u32) {
        self.client.submit_rainfall_data(
            &self.oracle,
            &String::from_str(&self.env, region),
            &rainfall_mm,
        );
    }
}

#[test]
fn test_parametric_crop_insurance_flow() {
    let fixture = Fixture::new(5_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);

    let region = "REGION_AFRICA_01";
    let policy_id = fixture.create(&farmer, region, 100, 500);

    let policy = fixture.client.get_policy(&policy_id);
    assert_eq!(policy.id, policy_id);
    assert_eq!(policy.status, PolicyStatus::Active);
    assert_eq!(fixture.balance(&farmer), 900);
    assert_eq!(fixture.client.get_total_active_coverage(), 500);
    assert_eq!(fixture.client.get_locked_premium(&policy_id), 100);
    assert_eq!(fixture.client.get_total_locked_premiums(), 100);
    assert!(fixture.client.is_solvent());

    fixture.rain(region, 30);
    assert_eq!(
        fixture
            .client
            .get_rainfall(&String::from_str(&fixture.env, region)),
        Some(30)
    );

    let payout = fixture.client.trigger_payout(&policy_id);
    assert_eq!(payout, 500);
    assert_eq!(fixture.balance(&farmer), 1_400);

    let updated_policy = fixture.client.get_policy(&policy_id);
    assert_eq!(updated_policy.status, PolicyStatus::Claimed);
    assert_eq!(fixture.client.get_total_active_coverage(), 0);
    assert_eq!(fixture.client.get_locked_premium(&policy_id), 0);
    assert_eq!(fixture.client.get_total_claims_paid(), 500);
}

#[test]
fn test_underwriting_rejected_when_reserves_cannot_back_coverage() {
    let fixture = Fixture::new(1_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);

    let result = fixture.client.try_create_policy(
        &farmer,
        &String::from_str(&fixture.env, "REGION_A"),
        &50,
        &true,
        &100,
        &5_000,
        &86_400,
    );

    assert!(matches!(result, Err(Ok(Error::InsufficientReserves))));
    assert_eq!(fixture.balance(&farmer), 1_000);
    assert_eq!(fixture.client.get_total_active_coverage(), 0);
    assert_eq!(fixture.client.get_total_locked_premiums(), 0);
}

#[test]
fn test_region_concentration_cap_tracks_cumulative_exposure() {
    let fixture = Fixture::new(10_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 10_000);
    fixture.client.set_reserve_config(&10_000, &2_500);

    let blocked = fixture.client.try_create_policy(
        &farmer,
        &String::from_str(&fixture.env, "REGION_A"),
        &50,
        &true,
        &100,
        &3_000,
        &86_400,
    );
    assert!(matches!(blocked, Err(Ok(Error::RegionCapExceeded))));

    let first = fixture.create(&farmer, "REGION_A", 100, 2_000);
    assert_eq!(
        fixture
            .client
            .get_region_coverage(&String::from_str(&fixture.env, "REGION_A")),
        2_000
    );

    let blocked_cumulative = fixture.client.try_create_policy(
        &farmer,
        &String::from_str(&fixture.env, "REGION_A"),
        &50,
        &true,
        &100,
        &600,
        &86_400,
    );
    assert!(matches!(
        blocked_cumulative,
        Err(Ok(Error::RegionCapExceeded))
    ));

    let second = fixture.create(&farmer, "REGION_B", 100, 600);
    assert_eq!(fixture.client.get_policy(&first).payout_amount, 2_000);
    assert_eq!(fixture.client.get_policy(&second).payout_amount, 600);
    assert_eq!(
        fixture
            .client
            .get_region_coverage(&String::from_str(&fixture.env, "REGION_B")),
        600
    );
}

#[test]
fn test_premium_lock_blocks_withdrawal_of_committed_reserves() {
    let fixture = Fixture::new(10_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);

    let policy_id = fixture.create(&farmer, "REGION_A", 100, 500);

    // 10,000 funding + 100 premium - 500 required - 100 locked = 9,600 free.
    assert_eq!(fixture.client.get_available_reserves(), 9_600);
    let over_withdrawal = fixture.client.try_withdraw_excess_reserves(&9_601);
    assert!(matches!(
        over_withdrawal,
        Err(Ok(Error::InsufficientReserves))
    ));

    fixture.client.withdraw_excess_reserves(&9_600);
    assert_eq!(fixture.balance(&fixture.admin), 9_600);
    assert_eq!(fixture.balance(&fixture.client.address), 500);

    let committed_withdrawal = fixture.client.try_withdraw_excess_reserves(&1);
    assert!(matches!(
        committed_withdrawal,
        Err(Ok(Error::InsufficientReserves))
    ));
    assert_eq!(fixture.client.get_locked_premium(&policy_id), 100);
    assert!(fixture.client.is_solvent());
}

#[test]
fn test_reserve_config_rejects_under_collateralised_thresholds() {
    let fixture = Fixture::new(5_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);
    fixture.create(&farmer, "REGION_A", 100, 500);

    assert!(matches!(
        fixture.client.try_set_reserve_config(&9_999, &5_000),
        Err(Ok(Error::InvalidRiskConfig))
    ));
    assert!(matches!(
        fixture.client.try_set_reserve_config(&10_001, &0),
        Err(Ok(Error::InvalidRiskConfig))
    ));
    assert!(matches!(
        fixture.client.try_set_reserve_config(&20_001, &5_000),
        Err(Ok(Error::InvalidRiskConfig))
    ));

    fixture.client.set_reserve_config(&20_000, &5_000);
    let config = fixture.client.get_reserve_config();
    assert_eq!(config.minimum_reserve_factor_bps, 20_000);
    assert_eq!(config.region_concentration_cap_bps, 5_000);
    assert!(fixture.client.is_solvent());
}

#[test]
fn test_stricter_reserve_factor_cannot_make_book_insolvent() {
    let fixture = Fixture::new(5_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);

    fixture.create(&farmer, "REGION_A", 100, 2_500);
    fixture.create(&farmer, "REGION_B", 100, 2_500);
    assert_eq!(fixture.client.get_liquid_reserves(), 5_200);
    assert_eq!(fixture.client.get_total_active_coverage(), 5_000);

    assert!(matches!(
        fixture.client.try_set_reserve_config(&10_500, &5_000),
        Err(Ok(Error::InsufficientReserves))
    ));
    assert_eq!(
        fixture
            .client
            .get_reserve_config()
            .minimum_reserve_factor_bps,
        10_000
    );
}

#[test]
fn test_reinsurance_treaty_recovers_excess_loss() {
    let fixture = Fixture::new(2_000);
    let farmer = Address::generate(&fixture.env);
    let reinsurer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);
    fixture.mint(&reinsurer, 2_000);

    let policy_id = fixture.create(&farmer, "REGION_A", 100, 1_000);
    fixture
        .client
        .set_reinsurance_treaty(&reinsurer, &1_000, &500);

    fixture.rain("REGION_A", 10);
    fixture.client.trigger_payout(&policy_id);

    assert_eq!(fixture.client.get_total_claims_paid(), 1_000);
    assert_eq!(fixture.client.reinsurance_recoverable(), 500);
    assert!(matches!(
        fixture.client.try_recover_from_reinsurer(&501),
        Err(Ok(Error::ReinsuranceLimitExceeded))
    ));

    fixture.client.recover_from_reinsurer(&500);
    assert_eq!(fixture.client.get_reinsurance_recovered(), 500);
    assert_eq!(fixture.client.reinsurance_recoverable(), 0);
    assert_eq!(fixture.balance(&reinsurer), 1_500);
    assert_eq!(fixture.balance(&fixture.client.address), 1_600);

    fixture.client.remove_reinsurance_treaty();
    assert!(matches!(
        fixture.client.try_recover_from_reinsurer(&1),
        Err(Ok(Error::NoReinsuranceTreaty))
    ));
}

#[test]
fn test_expiry_releases_coverage_and_premium_lock() {
    let fixture = Fixture::new(5_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);

    let policy_id = fixture.create(&farmer, "REGION_A", 100, 500);
    fixture.env.ledger().set_timestamp(90_000);
    fixture.client.expire_policy(&policy_id);

    let policy = fixture.client.get_policy(&policy_id);
    assert_eq!(policy.status, PolicyStatus::Expired);
    assert_eq!(fixture.client.get_total_active_coverage(), 0);
    assert_eq!(fixture.client.get_locked_premium(&policy_id), 0);
    assert_eq!(fixture.client.get_total_locked_premiums(), 0);

    fixture.client.withdraw_excess_reserves(&5_100);
    assert_eq!(fixture.balance(&fixture.admin), 5_100);
    assert_eq!(fixture.balance(&fixture.client.address), 0);
    assert!(fixture.client.is_solvent());
}

/// Simulates every active policy suffering a 100% loss. The reserve factor
/// requires the pool to hold the full aggregate coverage, so no claim can be
/// underfunded and the pool settles to exactly zero.
#[test]
fn test_concurrent_total_loss_across_all_policies() {
    let fixture = Fixture::new(10_000);
    let farmer = Address::generate(&fixture.env);
    fixture.mint(&farmer, 1_000);

    let regions = ["REGION_NORTH", "REGION_SOUTH", "REGION_EAST", "REGION_WEST"];
    let mut policy_ids = [0u64; 4];

    for (index, region) in regions.iter().enumerate() {
        policy_ids[index] = fixture.create(&farmer, region, 100, 2_600);
        fixture.rain(region, 5);
    }

    assert_eq!(fixture.client.get_total_active_coverage(), 10_400);
    assert_eq!(fixture.client.get_liquid_reserves(), 10_400);
    assert_eq!(fixture.client.get_total_locked_premiums(), 400);
    assert!(fixture.client.is_solvent());

    for &policy_id in &policy_ids {
        let payout = fixture.client.trigger_payout(&policy_id);
        assert_eq!(payout, 2_600);
        assert_eq!(
            fixture.client.get_policy(&policy_id).status,
            PolicyStatus::Claimed
        );
    }

    assert_eq!(fixture.balance(&farmer), 11_000);
    assert_eq!(fixture.client.get_liquid_reserves(), 0);
    assert_eq!(fixture.client.get_total_active_coverage(), 0);
    assert_eq!(fixture.client.get_total_locked_premiums(), 0);
    assert_eq!(fixture.client.get_total_claims_paid(), 10_400);
    assert!(fixture.client.is_solvent());

    let already_claimed = fixture.client.try_trigger_payout(&policy_ids[0]);
    assert!(matches!(already_claimed, Err(Ok(Error::PolicyNotActive))));
}
