#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env, String};

#[test]
fn test_submit_and_review() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);

    client.init(&admin);

    let title = String::from_str(&env, "Test Bug");
    let target = String::from_str(&env, "ContractX");
    let severity = Severity::High;

    let report_id = client.submit_bug(&reporter, &title, &target, &severity);
    assert_eq!(report_id, 1);

    let report = client.get_report(&report_id);
    assert_eq!(report.status, BountyStatus::Open);
    assert_eq!(report.reporter, reporter);

    // Review the bug
    client.review_bug(&admin, &report_id, &BountyStatus::Resolved, &5000);

    let reviewed_report = client.get_report(&report_id);
    assert_eq!(reviewed_report.status, BountyStatus::Resolved);
    assert_eq!(reviewed_report.reward, 5000);
}

#[test]
#[should_panic(expected = "Contract is paused")]
fn test_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, BugBountyContract);
    let client = BugBountyContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let reporter = Address::generate(&env);

    client.init(&admin);
    client.pause(&admin);

    let title = String::from_str(&env, "Test Bug");
    let target = String::from_str(&env, "ContractX");
    let severity = Severity::High;

    // This should panic
    client.submit_bug(&reporter, &title, &target, &severity);
}
