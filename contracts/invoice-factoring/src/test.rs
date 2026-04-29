#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _};
use soroban_sdk::{Env, Address};

#[test]
fn test_factoring_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, InvoiceFactoring);
    let client = InvoiceFactoringClient::new(&env, &contract_id);

    let business = Address::generate(&env);
    let investor = Address::generate(&env);
    
    // Submit invoice: $1000 with risk score 5
    let invoice_id = client.submit_invoice(&business, &1000, &5);
    
    // Verify invoice data
    let invoice = client.get_invoice(&1).unwrap();
    assert_eq!(invoice.discount_rate, 250); // 200 + (5 * 10)
    assert!(invoice.due_date > env.ledger().timestamp());
    assert_eq!(invoice.status, InvoiceStatus::Pending);

    // Fund it
    let success = client.fund_invoice(&investor, &1);
    assert!(success);
}
