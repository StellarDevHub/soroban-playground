#![cfg(test)]
use super::*;
use soroban_sdk::testutils::{Address as _, Events};
use soroban_sdk::{vec, IntoVal, symbol_short};

#[test]
fn test_credit_scoring_on_repay() {
    let env = Env::default();
    let contract_id = env.register_contract(None, LendingProtocol);
    let client = LendingProtocolClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    client.initialize(&admin);

    // Mock a position: Deposit 100, Borrow 50
    client.deposit(&user, &100);
    client.borrow(&user, &50);

    // Repay 20
    client.repay(&user, &20);

    let pos = client.get_user_position(&user);
    assert_eq!(pos.credit_score, 5);
    
    // Verify Event emission
    let last_event = env.events().all().last().unwrap();
    assert_eq!(
        last_event,
        (
            contract_id.clone(),
            (symbol_short!("repayment"), user.clone()).into_val(&env),
            (20i128, 5i128).into_val(&env)
        )
    );
}
