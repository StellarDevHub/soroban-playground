use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
};

struct Fixture {
    env: Env,
    id: Address,
    admin: Address,
    user: Address,
    token: Address,
    symbol: String,
}

impl Fixture {
    fn new() -> Self {
        let mut env = Env::default();
        env.set_config(soroban_sdk::testutils::EnvTestConfig {
            capture_snapshot_at_drop: false,
        });
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let token = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let id = env.register_contract(None, SyntheticAssets);
        let client = SyntheticAssetsClient::new(&env, &id);
        client.initialize(&admin, &token);
        client.update_collateral_price(&admin, &PRICE_SCALE);
        let symbol = String::from_str(&env, "sUSD");
        client.register_asset(&admin, &symbol, &admin);
        client.update_price(&admin, &symbol, &PRICE_SCALE);
        StellarAssetClient::new(&env, &token).mint(&user, &(10_000_000 * PRICE_SCALE));
        Self {
            env,
            id,
            admin,
            user,
            token,
            symbol,
        }
    }
    fn client(&self) -> SyntheticAssetsClient<'_> {
        SyntheticAssetsClient::new(&self.env, &self.id)
    }
    fn mint(&self, amount: i128) {
        self.client()
            .mint(&self.user, &self.symbol, &(4 * amount), &amount);
    }
    fn settle(&self) {
        self.env
            .ledger()
            .with_mut(|l| l.sequence_number += FEE_DELAY_LEDGERS);
    }
    fn other(&self) -> String {
        let symbol = String::from_str(&self.env, "sGOLD");
        self.client()
            .register_asset(&self.admin, &symbol, &self.admin);
        self.client()
            .update_price(&self.admin, &symbol, &(2 * PRICE_SCALE));
        symbol
    }
}

#[test]
fn total_position_is_repriced_before_another_mint() {
    let f = Fixture::new();
    f.mint(100 * PRICE_SCALE);
    f.client()
        .update_price(&f.admin, &f.symbol, &(4 * PRICE_SCALE));
    // The new deposit alone meets 400%, but the combined position does not.
    assert_eq!(
        f.client()
            .try_mint(&f.user, &f.symbol, &(16 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::CollateralRatioTooLow))
    );
    assert_eq!(
        f.client().get_position(&f.user).synth_amount,
        100 * PRICE_SCALE
    );
    assert_eq!(
        f.client().get_asset(&f.symbol).total_supply,
        100 * PRICE_SCALE
    );
}

#[test]
fn collateral_depeg_blocks_mint_and_triggers_paid_liquidation() {
    let f = Fixture::new();
    f.mint(100 * PRICE_SCALE);
    f.client()
        .update_collateral_price(&f.admin, &(PRICE_SCALE * 3 / 10));
    assert_eq!(f.client().collateral_ratio(&f.user), 12_000);
    assert_eq!(
        f.client()
            .try_mint(&f.user, &f.symbol, &(4 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::CollateralRatioTooLow))
    );
    let liquidator = Address::generate(&f.env);
    StellarAssetClient::new(&f.env, &f.token).mint(&liquidator, &(1_000 * PRICE_SCALE));
    let token = token::Client::new(&f.env, &f.token);
    let before_reserve = token.balance(&f.admin);
    let before_liquidator = token.balance(&liquidator);
    let payment = (100 * PRICE_SCALE * 10 + 2) / 3;
    let seized = f
        .client()
        .liquidate(&liquidator, &f.user, &(100 * PRICE_SCALE));
    assert_eq!(token.balance(&f.admin) - before_reserve, payment);
    assert_eq!(
        token.balance(&liquidator) - before_liquidator,
        seized - payment
    );
    assert_eq!(f.client().get_asset(&f.symbol).total_supply, 0);
    assert_eq!(token.balance(&f.id), 0); // residual collateral returned to owner
    assert!(matches!(
        f.client().try_get_position(&f.user),
        Err(Ok(Error::PositionNotFound))
    ));
}

#[test]
fn liquidation_boundary_and_invalid_amounts() {
    let f = Fixture::new();
    f.mint(100 * PRICE_SCALE);
    f.client()
        .update_collateral_price(&f.admin, &(PRICE_SCALE * 3 / 8));
    assert_eq!(f.client().collateral_ratio(&f.user), 15_000);
    assert_eq!(
        f.client().try_liquidate(&f.user, &f.user, &PRICE_SCALE),
        Err(Ok(Error::PositionHealthy))
    );
    assert_eq!(
        f.client().try_liquidate(&f.user, &f.user, &0),
        Err(Ok(Error::InvalidAmount))
    );
    f.client()
        .update_collateral_price(&f.admin, &(PRICE_SCALE * 3 / 8 - 1));
    assert!(f.client().collateral_ratio(&f.user) < 15_000);
}

#[test]
fn fees_are_dynamic_and_paid_on_mint_and_burn() {
    let f = Fixture::new();
    let token = token::Client::new(&f.env, &f.token);
    f.mint(100 * PRICE_SCALE);
    let small_fee = token.balance(&f.admin);
    assert_eq!(small_fee, 100 * PRICE_SCALE * 25 / 10_000);
    f.mint(9_900 * PRICE_SCALE);
    let full_fee = token.balance(&f.admin) - small_fee;
    assert_eq!(full_fee, 9_900 * PRICE_SCALE / 100);
    f.settle();
    let before = token.balance(&f.admin);
    let returned = f.client().burn(&f.user, &f.symbol, &(100 * PRICE_SCALE));
    assert_eq!(returned, 400 * PRICE_SCALE);
    assert_eq!(token.balance(&f.admin) - before, PRICE_SCALE);
    assert_eq!(token.balance(&f.id), 39_600 * PRICE_SCALE);
}

#[test]
fn ceiling_is_shared_by_users_and_released_on_burn() {
    let f = Fixture::new();
    f.mint(10_000 * PRICE_SCALE);
    let other = Address::generate(&f.env);
    assert_eq!(
        f.client()
            .try_mint(&other, &f.symbol, &(4 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::DebtCeiling))
    );
    f.settle();
    f.client().burn(&f.user, &f.symbol, &PRICE_SCALE);
    f.mint(PRICE_SCALE);
    assert_eq!(
        f.client().get_asset(&f.symbol).total_supply,
        10_000 * PRICE_SCALE
    );
    f.client()
        .set_asset_tier(&f.admin, &f.symbol, &AssetTier::Standard);
    assert_eq!(f.client().debt_ceiling(&f.symbol), 100_000 * PRICE_SCALE);
    f.mint(PRICE_SCALE);
    assert_eq!(
        f.client()
            .try_set_asset_tier(&f.admin, &f.symbol, &AssetTier::Experimental),
        Err(Ok(Error::DebtCeiling))
    );
}

#[test]
fn flash_round_trips_and_cross_symbol_bypasses_fail() {
    let f = Fixture::new();
    let other = f.other();
    f.mint(100 * PRICE_SCALE);
    assert_eq!(
        f.client().try_burn(&f.user, &f.symbol, &PRICE_SCALE),
        Err(Ok(Error::TradeDelayActive))
    );
    assert_eq!(
        f.client()
            .try_swap(&f.user, &f.symbol, &other, &(100 * PRICE_SCALE)),
        Err(Ok(Error::TradeDelayActive))
    );
    assert_eq!(
        f.client()
            .try_mint(&f.user, &other, &(8 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::WrongAsset))
    );
    f.settle();
    assert_eq!(
        f.client().try_burn(&f.user, &other, &PRICE_SCALE),
        Err(Ok(Error::WrongAsset))
    );
    assert_eq!(
        f.client()
            .try_swap(&f.user, &other, &f.symbol, &PRICE_SCALE),
        Err(Ok(Error::WrongAsset))
    );
    assert_eq!(
        f.client()
            .try_swap(&f.user, &f.symbol, &other, &PRICE_SCALE),
        Err(Ok(Error::PartialSwap))
    );
    let amount = f
        .client()
        .swap(&f.user, &f.symbol, &other, &(100 * PRICE_SCALE));
    assert_eq!(amount, 50 * PRICE_SCALE);
    assert_eq!(f.client().get_asset(&f.symbol).total_supply, 0);
    assert_eq!(f.client().get_asset(&other).total_supply, amount);
    assert_eq!(f.client().get_position(&f.user).synth_amount, amount);
    assert_eq!(
        f.client().try_burn(&f.user, &other, &amount),
        Err(Ok(Error::TradeDelayActive))
    );
}

#[test]
fn swaps_enforce_destination_ceiling() {
    let f = Fixture::new();
    let other = f.other();
    f.client()
        .set_asset_tier(&f.admin, &f.symbol, &AssetTier::Standard);
    f.mint(10_001 * PRICE_SCALE);
    f.settle();
    assert_eq!(
        f.client()
            .try_swap(&f.user, &f.symbol, &other, &(10_001 * PRICE_SCALE)),
        Err(Ok(Error::DebtCeiling))
    );
    assert_eq!(f.client().get_asset(&other).total_supply, 0);
}

#[test]
fn stale_or_missing_prices_fail_closed() {
    let f = Fixture::new();
    f.env.ledger().with_mut(|l| l.timestamp = MAX_PRICE_AGE + 1);
    assert_eq!(
        f.client()
            .try_mint(&f.user, &f.symbol, &(4 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::StalePrice))
    );
    f.client().update_price(&f.admin, &f.symbol, &PRICE_SCALE);
    assert_eq!(
        f.client()
            .try_mint(&f.user, &f.symbol, &(4 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::StalePrice))
    );
    f.client().update_collateral_price(&f.admin, &PRICE_SCALE);
    f.mint(PRICE_SCALE);
    let wrong = Address::generate(&f.env);
    assert_eq!(
        f.client().try_update_collateral_price(&wrong, &PRICE_SCALE),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn tiny_debt_cannot_round_away_and_overflow_rolls_back() {
    let f = Fixture::new();
    f.client().update_price(&f.admin, &f.symbol, &1);
    assert_eq!(
        f.client().try_mint(&f.user, &f.symbol, &1, &1),
        Err(Ok(Error::CollateralRatioTooLow))
    );
    assert_eq!(
        f.client()
            .try_mint(&f.user, &f.symbol, &i128::MAX, &i128::MAX),
        Err(Ok(Error::Overflow))
    );
    assert_eq!(f.client().get_asset(&f.symbol).total_supply, 0);
    f.client().mint(&f.user, &f.symbol, &4, &1);
    assert_eq!(token::Client::new(&f.env, &f.token).balance(&f.admin), 1);
}

#[test]
fn failed_fee_payment_rolls_back_deposit_and_supply() {
    let f = Fixture::new();
    let poor = Address::generate(&f.env);
    StellarAssetClient::new(&f.env, &f.token).mint(&poor, &(4 * PRICE_SCALE));
    assert!(f
        .client()
        .try_mint(&poor, &f.symbol, &(4 * PRICE_SCALE), &PRICE_SCALE)
        .is_err());
    assert_eq!(
        token::Client::new(&f.env, &f.token).balance(&poor),
        4 * PRICE_SCALE
    );
    assert_eq!(token::Client::new(&f.env, &f.token).balance(&f.id), 0);
    assert_eq!(f.client().get_asset(&f.symbol).total_supply, 0);
}

#[test]
fn unfunded_liquidation_cannot_seize_collateral() {
    let f = Fixture::new();
    f.mint(100 * PRICE_SCALE);
    f.client()
        .update_collateral_price(&f.admin, &(PRICE_SCALE / 4));
    let poor = Address::generate(&f.env);
    assert!(f
        .client()
        .try_liquidate(&poor, &f.user, &PRICE_SCALE)
        .is_err());
    assert_eq!(
        f.client().get_position(&f.user).collateral,
        400 * PRICE_SCALE
    );
    assert_eq!(
        f.client().get_asset(&f.symbol).total_supply,
        100 * PRICE_SCALE
    );
    assert_eq!(token::Client::new(&f.env, &f.token).balance(&poor), 0);
}

#[test]
fn price_growth_blocks_issuance_over_ceiling_but_allows_full_burn() {
    let f = Fixture::new();
    f.mint(10_000 * PRICE_SCALE);
    f.client()
        .update_price(&f.admin, &f.symbol, &(2 * PRICE_SCALE));
    // Sufficient added collateral repairs health, but cannot bypass the ceiling.
    assert_eq!(
        f.client()
            .try_mint(&f.user, &f.symbol, &(100_000 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::DebtCeiling))
    );
    f.settle();
    f.client().burn(&f.user, &f.symbol, &(10_000 * PRICE_SCALE));
    assert_eq!(f.client().get_asset(&f.symbol).total_supply, 0);
}

#[test]
fn partial_burn_cannot_withdraw_unhealthy_collateral() {
    let f = Fixture::new();
    f.mint(100 * PRICE_SCALE);
    f.client()
        .update_collateral_price(&f.admin, &(PRICE_SCALE / 4));
    f.settle();
    let before = token::Client::new(&f.env, &f.token).balance(&f.admin);
    assert_eq!(
        f.client().try_burn(&f.user, &f.symbol, &PRICE_SCALE),
        Err(Ok(Error::CollateralRatioTooLow))
    );
    assert_eq!(
        token::Client::new(&f.env, &f.token).balance(&f.admin),
        before
    );
    assert_eq!(
        f.client().get_position(&f.user).collateral,
        400 * PRICE_SCALE
    );
}

#[test]
fn authorization_and_reserve_self_payment_cannot_be_bypassed() {
    let f = Fixture::new();
    assert!(f
        .client()
        .try_set_asset_tier(&f.user, &f.symbol, &AssetTier::Stable)
        .is_err());
    assert_eq!(
        f.client().try_configure_risk(&f.admin, &f.id, &f.admin),
        Err(Ok(Error::InvalidRiskConfig))
    );
    f.client().configure_risk(&f.admin, &f.user, &f.admin);
    f.client().update_collateral_price(&f.admin, &PRICE_SCALE);
    assert_eq!(
        f.client()
            .try_mint(&f.user, &f.symbol, &(4 * PRICE_SCALE), &PRICE_SCALE),
        Err(Ok(Error::InvalidRiskConfig))
    );
    f.env.mock_auths(&[]);
    assert!(f
        .client()
        .try_update_collateral_price(&f.admin, &PRICE_SCALE)
        .is_err());
}
