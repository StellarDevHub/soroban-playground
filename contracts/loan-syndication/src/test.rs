#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

use crate::types::{Error, LoanStatus, Tranche};
use crate::{LoanSyndication, LoanSyndicationClient};

struct Fixture {
    env: Env,
    client: LoanSyndicationClient<'static>,
    admin: Address,
    borrower: Address,
    token_client: TokenClient<'static>,
    token_admin: StellarAssetClient<'static>,
    collateral_client: TokenClient<'static>,
    loan_id: u32,
    funding_deadline: u64,
    maturity: u64,
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LoanSyndication);
    let client = LoanSyndicationClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let borrower = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token_address = env.register_stellar_asset_contract_v2(issuer).address();
    let token_client = TokenClient::new(&env, &token_address);
    let token_admin = StellarAssetClient::new(&env, &token_address);

    let collateral_issuer = Address::generate(&env);
    let collateral_address = env
        .register_stellar_asset_contract_v2(collateral_issuer)
        .address();
    let collateral_client = TokenClient::new(&env, &collateral_address);
    let collateral_admin = StellarAssetClient::new(&env, &collateral_address);

    client.initialize(&admin);
    let funding_deadline = env.ledger().timestamp() + 100;
    let maturity = env.ledger().timestamp() + 200;
    let loan_id = client.create_loan(
        &borrower,
        &token_address,
        &1_000,
        &700,
        &1_000,
        &2_000,
        &funding_deadline,
        &maturity,
        &50,
    );
    // Borrower locks 500 collateral; a liquidator can buy it all for 100.
    collateral_admin.mint(&borrower, &500);
    client.post_collateral(&loan_id, &collateral_address, &500, &100);

    Fixture {
        env,
        client,
        admin,
        borrower,
        token_client,
        token_admin,
        collateral_client,
        loan_id,
        funding_deadline,
        maturity,
    }
}

fn fund_full(fixture: &Fixture) -> (Address, Address) {
    let senior = Address::generate(&fixture.env);
    let junior = Address::generate(&fixture.env);
    fixture.token_admin.mint(&senior, &700);
    fixture.token_admin.mint(&junior, &300);
    fixture.client.fund(&senior, &fixture.loan_id, &0, &700);
    fixture.client.fund(&junior, &fixture.loan_id, &1, &300);
    (senior, junior)
}

fn draw_full(fixture: &Fixture) -> (Address, Address) {
    let lenders = fund_full(fixture);
    fixture.client.drawdown(&fixture.loan_id);
    lenders
}

/// Move past maturity + grace period and mark the loan defaulted.
fn default_loan(fixture: &Fixture) {
    fixture.env.ledger().set_timestamp(fixture.maturity + 50);
    fixture.client.mark_default(&fixture.loan_id);
}

/// Create a funded liquidator holding `amount` of the loan asset.
fn make_liquidator(fixture: &Fixture, amount: i128) -> Address {
    let liquidator = Address::generate(&fixture.env);
    fixture.token_admin.mint(&liquidator, &amount);
    liquidator
}

#[test]
fn initialize_and_create_loan() {
    let fixture = setup();
    let loan = fixture.client.get_loan(&fixture.loan_id);
    assert_eq!(loan.status, LoanStatus::Funding);
    assert_eq!(loan.senior_target, 700);
    assert_eq!(loan.junior_target, 300);
    assert_eq!(loan.collateral_held, 500);
    assert_eq!(loan.liquidation_price, 100);
    assert_eq!(fixture.client.loan_count(), 1);
    assert_eq!(fixture.client.total_due(&fixture.loan_id), 1_130);
}

#[test]
fn initialize_twice_fails() {
    let fixture = setup();
    assert_eq!(
        fixture.client.try_initialize(&fixture.admin),
        Err(Ok(Error::AlreadyInitialized))
    );
}

#[test]
fn invalid_terms_are_rejected() {
    let fixture = setup();
    let token = fixture.client.get_loan(&fixture.loan_id).asset;
    assert_eq!(
        fixture.client.try_create_loan(
            &fixture.borrower,
            &token,
            &1_000,
            &1_000,
            &1_000,
            &2_000,
            &fixture.funding_deadline,
            &fixture.maturity,
            &50,
        ),
        Err(Ok(Error::InvalidTerms))
    );
    assert_eq!(
        fixture.client.try_create_loan(
            &fixture.borrower,
            &token,
            &1_000,
            &700,
            &3_000,
            &2_000,
            &fixture.funding_deadline,
            &fixture.maturity,
            &50,
        ),
        Err(Ok(Error::InvalidTerms))
    );
}

#[test]
fn lenders_fund_independent_tranches_with_real_tokens() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &1_000);
    fixture.client.fund(&lender, &fixture.loan_id, &0, &400);
    fixture.client.fund(&lender, &fixture.loan_id, &1, &200);

    assert_eq!(fixture.token_client.balance(&lender), 400);
    assert_eq!(
        fixture
            .client
            .get_position(&fixture.loan_id, &lender, &0)
            .principal,
        400
    );
    assert_eq!(
        fixture
            .client
            .get_position(&fixture.loan_id, &lender, &1)
            .principal,
        200
    );
}

#[test]
fn repeated_funding_accumulates() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &700);
    fixture.client.fund(&lender, &fixture.loan_id, &0, &300);
    fixture.client.fund(&lender, &fixture.loan_id, &0, &400);
    assert_eq!(
        fixture
            .client
            .get_position(&fixture.loan_id, &lender, &0)
            .principal,
        700
    );
}

#[test]
fn tranche_capacity_and_identifier_are_enforced() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &1_000);
    assert_eq!(
        fixture.client.try_fund(&lender, &fixture.loan_id, &0, &701),
        Err(Ok(Error::TrancheCapacityExceeded))
    );
    assert_eq!(
        fixture.client.try_fund(&lender, &fixture.loan_id, &2, &10),
        Err(Ok(Error::InvalidTranche))
    );
    assert_eq!(fixture.token_client.balance(&lender), 1_000);
}

#[test]
fn funding_deadline_is_enforced() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &100);
    fixture.env.ledger().set_timestamp(fixture.funding_deadline);
    assert_eq!(
        fixture.client.try_fund(&lender, &fixture.loan_id, &0, &100),
        Err(Ok(Error::FundingClosed))
    );
}

#[test]
fn drawdown_requires_both_tranches() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &700);
    fixture.client.fund(&lender, &fixture.loan_id, &0, &700);
    assert_eq!(
        fixture.client.try_drawdown(&fixture.loan_id),
        Err(Ok(Error::LoanNotFunded))
    );
    // Principal stays locked in the contract while the syndicate is incomplete.
    assert_eq!(fixture.token_client.balance(&fixture.borrower), 0);
}

#[test]
fn drawdown_requires_collateral() {
    let fixture = setup();
    // A second loan with no collateral posted.
    let token = fixture.token_client.address.clone();
    let loan_two = fixture.client.create_loan(
        &fixture.borrower,
        &token,
        &1_000,
        &700,
        &1_000,
        &2_000,
        &fixture.funding_deadline,
        &fixture.maturity,
        &50,
    );
    let senior = Address::generate(&fixture.env);
    let junior = Address::generate(&fixture.env);
    fixture.token_admin.mint(&senior, &700);
    fixture.token_admin.mint(&junior, &300);
    fixture.client.fund(&senior, &loan_two, &0, &700);
    fixture.client.fund(&junior, &loan_two, &1, &300);

    assert_eq!(
        fixture.client.try_drawdown(&loan_two),
        Err(Ok(Error::CollateralRequired))
    );
}

#[test]
fn drawdown_transfers_principal_once() {
    let fixture = setup();
    fund_full(&fixture);
    fixture.client.drawdown(&fixture.loan_id);
    assert_eq!(fixture.token_client.balance(&fixture.borrower), 1_000);
    assert_eq!(
        fixture.client.get_loan(&fixture.loan_id).status,
        LoanStatus::Active
    );
    assert_eq!(
        fixture.client.try_drawdown(&fixture.loan_id),
        Err(Ok(Error::InvalidLoanStatus))
    );
}

#[test]
fn repayment_is_capped_and_marks_repaid() {
    let fixture = setup();
    draw_full(&fixture);
    fixture.token_admin.mint(&fixture.borrower, &130);
    let actual = fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &2_000);
    assert_eq!(actual, 1_130);
    assert_eq!(
        fixture.client.get_loan(&fixture.loan_id).status,
        LoanStatus::Repaid
    );
    assert_eq!(fixture.token_client.balance(&fixture.borrower), 0);
}

#[test]
fn full_repayment_distributes_fixed_yields() {
    let fixture = setup();
    let (senior, junior) = draw_full(&fixture);
    fixture.token_admin.mint(&fixture.borrower, &130);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &1_130);

    assert_eq!(fixture.client.claim(&senior, &fixture.loan_id, &0), 770);
    assert_eq!(fixture.client.claim(&junior, &fixture.loan_id, &1), 360);
    assert_eq!(fixture.token_client.balance(&senior), 770);
    assert_eq!(fixture.token_client.balance(&junior), 360);
}

#[test]
fn senior_claims_are_proportional_across_lenders() {
    let fixture = setup();
    let senior_a = Address::generate(&fixture.env);
    let senior_b = Address::generate(&fixture.env);
    let junior = Address::generate(&fixture.env);
    fixture.token_admin.mint(&senior_a, &300);
    fixture.token_admin.mint(&senior_b, &400);
    fixture.token_admin.mint(&junior, &300);
    fixture.client.fund(&senior_a, &fixture.loan_id, &0, &300);
    fixture.client.fund(&senior_b, &fixture.loan_id, &0, &400);
    fixture.client.fund(&junior, &fixture.loan_id, &1, &300);
    fixture.client.drawdown(&fixture.loan_id);
    fixture.token_admin.mint(&fixture.borrower, &130);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &1_130);

    assert_eq!(fixture.client.claim(&senior_a, &fixture.loan_id, &0), 330);
    assert_eq!(fixture.client.claim(&senior_b, &fixture.loan_id, &0), 440);
}

#[test]
fn junior_absorbs_default_loss_before_senior() {
    let fixture = setup();
    let (senior, junior) = draw_full(&fixture);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &800);
    default_loan(&fixture);
    // Collateral recovery adds 100 to the waterfall: 800 + 100 = 900.
    let liquidator = make_liquidator(&fixture, 100);
    fixture.client.liquidate(&liquidator, &fixture.loan_id);

    let senior_summary = fixture.client.tranche_summary(&fixture.loan_id, &0);
    let junior_summary = fixture.client.tranche_summary(&fixture.loan_id, &1);
    assert_eq!(senior_summary.settlement_allocation, 770);
    assert_eq!(junior_summary.settlement_allocation, 130);
    assert_eq!(fixture.client.claim(&senior, &fixture.loan_id, &0), 770);
    assert_eq!(fixture.client.claim(&junior, &fixture.loan_id, &1), 130);
}

#[test]
fn deeper_default_reduces_senior_and_wipes_junior() {
    let fixture = setup();
    let (senior, junior) = draw_full(&fixture);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &500);
    default_loan(&fixture);
    // 500 repaid + 100 recovered from collateral = 600.
    let liquidator = make_liquidator(&fixture, 100);
    fixture.client.liquidate(&liquidator, &fixture.loan_id);

    assert_eq!(
        fixture
            .client
            .calculate_claim(&fixture.loan_id, &senior, &0),
        600
    );
    assert_eq!(
        fixture
            .client
            .calculate_claim(&fixture.loan_id, &junior, &1),
        0
    );
    assert_eq!(
        fixture.client.try_claim(&junior, &fixture.loan_id, &1),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn default_cannot_be_marked_early() {
    let fixture = setup();
    draw_full(&fixture);
    fixture.env.ledger().set_timestamp(fixture.maturity + 49);
    assert_eq!(
        fixture.client.try_mark_default(&fixture.loan_id),
        Err(Ok(Error::LoanNotMatured))
    );
}

#[test]
fn claim_is_single_use() {
    let fixture = setup();
    let (senior, _) = draw_full(&fixture);
    fixture.token_admin.mint(&fixture.borrower, &130);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &1_130);
    fixture.client.claim(&senior, &fixture.loan_id, &0);
    assert_eq!(
        fixture.client.try_claim(&senior, &fixture.loan_id, &0),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn cancelled_loan_refunds_each_lender() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &400);
    fixture.client.fund(&lender, &fixture.loan_id, &0, &400);
    fixture
        .client
        .cancel_loan(&fixture.borrower, &fixture.loan_id);

    assert_eq!(
        fixture.client.claim_refund(&lender, &fixture.loan_id, &0),
        400
    );
    assert_eq!(fixture.token_client.balance(&lender), 400);
    assert_eq!(
        fixture
            .client
            .try_claim_refund(&lender, &fixture.loan_id, &0),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn outsider_cannot_cancel() {
    let fixture = setup();
    let outsider = Address::generate(&fixture.env);
    assert_eq!(
        fixture.client.try_cancel_loan(&outsider, &fixture.loan_id),
        Err(Ok(Error::Unauthorized))
    );
}

#[test]
fn expired_funding_can_be_refunded() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &200);
    fixture.client.fund(&lender, &fixture.loan_id, &0, &200);
    fixture.env.ledger().set_timestamp(fixture.funding_deadline);
    fixture.client.expire_loan(&fixture.loan_id);
    assert_eq!(
        fixture.client.claim_refund(&lender, &fixture.loan_id, &0),
        200
    );
}

#[test]
fn pause_blocks_new_risk_but_not_refunds() {
    let fixture = setup();
    let lender = Address::generate(&fixture.env);
    fixture.token_admin.mint(&lender, &100);
    fixture.client.pause();
    assert!(fixture.client.is_paused());
    assert_eq!(
        fixture.client.try_fund(&lender, &fixture.loan_id, &0, &100),
        Err(Ok(Error::ContractPaused))
    );
    fixture.client.unpause();
    fixture.client.fund(&lender, &fixture.loan_id, &0, &100);
}

#[test]
fn claim_before_settlement_is_rejected() {
    let fixture = setup();
    let (senior, _) = draw_full(&fixture);
    assert_eq!(
        fixture.client.try_claim(&senior, &fixture.loan_id, &0),
        Err(Ok(Error::InvalidLoanStatus))
    );
}

#[test]
fn tranche_summary_reports_risk_terms() {
    let fixture = setup();
    fund_full(&fixture);
    let senior = fixture.client.tranche_summary(&fixture.loan_id, &0);
    let junior = fixture.client.tranche_summary(&fixture.loan_id, &1);
    assert_eq!(senior.tranche, Tranche::Senior);
    assert_eq!(senior.funded, 700);
    assert_eq!(senior.amount_due, 770);
    assert_eq!(junior.tranche, Tranche::Junior);
    assert_eq!(junior.funded, 300);
    assert_eq!(junior.amount_due, 360);
}

// ---------------------------------------------------------------------------
// Collateral, liquidation and reserve
// ---------------------------------------------------------------------------

#[test]
fn collateral_is_held_by_the_contract() {
    let fixture = setup();
    assert_eq!(fixture.collateral_client.balance(&fixture.borrower), 0);
    assert_eq!(
        fixture
            .collateral_client
            .balance(&fixture.client.address),
        500
    );
}

#[test]
fn claim_blocked_until_liquidated() {
    let fixture = setup();
    let (senior, _) = draw_full(&fixture);
    default_loan(&fixture);
    assert_eq!(
        fixture.client.try_claim(&senior, &fixture.loan_id, &0),
        Err(Ok(Error::RecoveryPending))
    );
}

#[test]
fn liquidate_before_default_is_rejected() {
    let fixture = setup();
    draw_full(&fixture);
    let liquidator = make_liquidator(&fixture, 100);
    assert_eq!(
        fixture.client.try_liquidate(&liquidator, &fixture.loan_id),
        Err(Ok(Error::NothingToLiquidate))
    );
}

#[test]
fn liquidation_pays_lenders_with_collateral_proceeds() {
    let fixture = setup();
    let (senior, _) = draw_full(&fixture);
    default_loan(&fixture);
    let liquidator = make_liquidator(&fixture, 100);

    let paid = fixture.client.liquidate(&liquidator, &fixture.loan_id);
    assert_eq!(paid, 100);
    assert_eq!(fixture.collateral_client.balance(&liquidator), 500);
    assert_eq!(fixture.token_client.balance(&liquidator), 0);

    let loan = fixture.client.get_loan(&fixture.loan_id);
    assert_eq!(loan.repaid, 100);
    assert_eq!(loan.collateral_held, 0);
    assert_eq!(loan.status, LoanStatus::Defaulted);

    // Senior is paid first from the recovery.
    assert_eq!(fixture.client.claim(&senior, &fixture.loan_id, &0), 100);
}

#[test]
fn liquidation_closes_loan_when_debt_is_covered() {
    let fixture = setup();
    draw_full(&fixture);
    // Borrower already repaid 1,100 of 1,130; only 30 is outstanding.
    fixture.token_admin.mint(&fixture.borrower, &100);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &1_100);
    default_loan(&fixture);
    let liquidator = make_liquidator(&fixture, 100);

    let paid = fixture.client.liquidate(&liquidator, &fixture.loan_id);
    assert_eq!(paid, 30);
    // Only 30/100 of the collateral is sold: 500 * 30 / 100 = 150.
    assert_eq!(fixture.collateral_client.balance(&liquidator), 150);
    let loan = fixture.client.get_loan(&fixture.loan_id);
    assert_eq!(loan.status, LoanStatus::Repaid);
    assert_eq!(loan.collateral_held, 350);

    // The borrower gets the leftover collateral back.
    assert_eq!(fixture.client.reclaim_collateral(&fixture.loan_id), 350);
    assert_eq!(fixture.collateral_client.balance(&fixture.borrower), 350);
}

#[test]
fn reclaim_collateral_after_full_repayment() {
    let fixture = setup();
    draw_full(&fixture);
    fixture.token_admin.mint(&fixture.borrower, &130);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &1_130);

    assert_eq!(fixture.client.reclaim_collateral(&fixture.loan_id), 500);
    assert_eq!(fixture.collateral_client.balance(&fixture.borrower), 500);
    assert_eq!(
        fixture.client.try_reclaim_collateral(&fixture.loan_id),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn reclaim_collateral_is_blocked_while_loan_is_active() {
    let fixture = setup();
    draw_full(&fixture);
    assert_eq!(
        fixture.client.try_reclaim_collateral(&fixture.loan_id),
        Err(Ok(Error::InvalidLoanStatus))
    );
}

#[test]
fn cancelled_loan_returns_collateral_to_borrower() {
    let fixture = setup();
    fixture
        .client
        .cancel_loan(&fixture.borrower, &fixture.loan_id);
    assert_eq!(fixture.client.reclaim_collateral(&fixture.loan_id), 500);
    assert_eq!(fixture.collateral_client.balance(&fixture.borrower), 500);
}

#[test]
fn rounding_dust_goes_to_reserve() {
    let fixture = setup();
    let senior = Address::generate(&fixture.env);
    let junior_a = Address::generate(&fixture.env);
    let junior_b = Address::generate(&fixture.env);
    let junior_c = Address::generate(&fixture.env);
    fixture.token_admin.mint(&senior, &700);
    fixture.token_admin.mint(&junior_a, &100);
    fixture.token_admin.mint(&junior_b, &100);
    fixture.token_admin.mint(&junior_c, &100);
    fixture.client.fund(&senior, &fixture.loan_id, &0, &700);
    fixture.client.fund(&junior_a, &fixture.loan_id, &1, &100);
    fixture.client.fund(&junior_b, &fixture.loan_id, &1, &100);
    fixture.client.fund(&junior_c, &fixture.loan_id, &1, &100);
    fixture.client.drawdown(&fixture.loan_id);

    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &800);
    default_loan(&fixture);
    let liquidator = make_liquidator(&fixture, 100);
    fixture.client.liquidate(&liquidator, &fixture.loan_id);

    // Junior allocation is 130; three equal lenders each get floor(130/3) = 43.
    assert_eq!(fixture.client.claim(&senior, &fixture.loan_id, &0), 770);
    assert_eq!(fixture.client.claim(&junior_a, &fixture.loan_id, &1), 43);
    assert_eq!(fixture.client.reserve(&fixture.loan_id), 0);
    assert_eq!(fixture.client.claim(&junior_b, &fixture.loan_id, &1), 43);
    assert_eq!(fixture.client.claim(&junior_c, &fixture.loan_id, &1), 43);

    // 130 - 3 * 43 = 1 unit is preserved in the reserve, not lost.
    assert_eq!(fixture.client.reserve(&fixture.loan_id), 1);
    assert_eq!(fixture.client.sweep_reserve(&fixture.loan_id), 1);
    assert_eq!(fixture.token_client.balance(&fixture.admin), 1);
    assert_eq!(fixture.client.reserve(&fixture.loan_id), 0);
    assert_eq!(
        fixture.client.try_sweep_reserve(&fixture.loan_id),
        Err(Ok(Error::NothingToClaim))
    );
}

#[test]
fn reserve_is_empty_until_everyone_claims() {
    let fixture = setup();
    let senior = Address::generate(&fixture.env);
    let junior_a = Address::generate(&fixture.env);
    let junior_b = Address::generate(&fixture.env);
    let junior_c = Address::generate(&fixture.env);
    fixture.token_admin.mint(&senior, &700);
    fixture.token_admin.mint(&junior_a, &100);
    fixture.token_admin.mint(&junior_b, &100);
    fixture.token_admin.mint(&junior_c, &100);
    fixture.client.fund(&senior, &fixture.loan_id, &0, &700);
    fixture.client.fund(&junior_a, &fixture.loan_id, &1, &100);
    fixture.client.fund(&junior_b, &fixture.loan_id, &1, &100);
    fixture.client.fund(&junior_c, &fixture.loan_id, &1, &100);
    fixture.client.drawdown(&fixture.loan_id);
    fixture
        .client
        .repay(&fixture.borrower, &fixture.loan_id, &800);
    default_loan(&fixture);
    let liquidator = make_liquidator(&fixture, 100);
    fixture.client.liquidate(&liquidator, &fixture.loan_id);

    fixture.client.claim(&junior_a, &fixture.loan_id, &1);
    fixture.client.claim(&junior_b, &fixture.loan_id, &1);
    // junior_c has not claimed yet, so nothing can be swept.
    assert_eq!(fixture.client.reserve(&fixture.loan_id), 0);
    assert_eq!(
        fixture.client.try_sweep_reserve(&fixture.loan_id),
        Err(Ok(Error::NothingToClaim))
    );
}
