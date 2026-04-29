#![cfg(test)]

use super::lending::{
    LendingContract, LendingContractClient, LendingError, DataKey, LoanStatus,
    Loan, CreditScore,
};
use soroban_sdk::{
    testutils::Address as _, Address, Env, BytesN, IntoVal,
};

fn setup() -> (Env, Address, Address, LendingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    
    let admin = Address::generate(&env);
    let borrower = Address::generate(&env);
    
    let contract_id = env.register(LendingContract, ());
    let client = LendingContractClient::new(&env, &contract_id);
    
    let collateral_token = Address::generate(&env);
    client.init(&admin, &collateral_token, &150u64, &500u64);
    
    (env, borrower, admin, client)
}

fn create_test_loan(
    env: &Env,
    client: &LendingContractClient,
    borrower: &Address,
) -> BytesN<32> {
    client.create_loan(&borrower, &1500i128, &1000i128)
}

#[test]
fn test_init() {
    let (env, _, _, client) = setup();
    let loans: Vec<Loan> = env.storage().instance().get(&DataKey::Loans).unwrap();
    assert_eq!(loans.len(), 0);
}

#[test]
fn test_create_loan() {
    let (env, borrower, _, client) = setup();
    
    let loan_id = create_test_loan(&env, &client, &borrower);
    
    let loan = client.get_loan(&loan_id).unwrap();
    assert_eq!(loan.borrower, borrower);
    assert_eq!(loan.loan_amount, 1000);
    assert_eq!(loan.status, LoanStatus::Active);
}

#[test]
fn test_repay_loan() {
    let (env, borrower, _, client) = setup();
    
    let loan_id = create_test_loan(&env, &client, &borrower);
    let remaining = client.repay_loan(&borrower, &loan_id, &500i128);
    
    assert!(remaining > 0);
    
    let loan = client.get_loan(&loan_id).unwrap();
    assert_eq!(loan.total_repaid, 500);
}

#[test]
fn test_credit_score() {
    let (env, borrower, _, client) = setup();
    
    let score_before = client.get_credit_score(&borrower);
    assert_eq!(score_before.score, 500);
    
    create_test_loan(&env, &client, &borrower);
    
    let score_after = client.get_credit_score(&borrower);
    assert_eq!(score_after.total_loans, 1);
}

#[test]
fn test_insufficient_collateral() {
    let (env, borrower, _, client) = setup();
    
    let result = std::panic::catch_unwind(|| {
        client.create_loan(&borrower, &100i128, &1000i128);
    });
    
    assert!(result.is_err());
}

#[test]
fn test_unauthorized_repayment() {
    let (env, borrower, _, client) = setup();
    
    let loan_id = create_test_loan(&env, &client, &borrower);
    
    let unauthorized = Address::generate(&env);
    let result = std::panic::catch_unwind(|| {
        client.repay_loan(&unauthorized, &loan_id, &100i128);
    });
    
    assert!(result.is_err());
}
