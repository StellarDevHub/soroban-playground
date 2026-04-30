#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{Env, Address};

#[test]
fn test_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, WarrantyContract);
    let client = WarrantyContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let product_id = 101;
    let duration = 3600; // 1 hour

    let warranty_id = client.register_product(&user, &product_id, &duration);
    assert_eq!(warranty_id, 1);

    let warranty = client.get_warranty(&1).unwrap();
    assert_eq!(warranty.owner, user);
    assert_eq!(warranty.product_id, product_id);
    assert_eq!(warranty.status, WarrantyStatus::Active);
}
