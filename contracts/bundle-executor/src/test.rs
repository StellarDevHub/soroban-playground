// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::Address as _,
    vec, Address, Env, Symbol,
};

// ── Minimal counter contract for testing sub-calls ───────────────────────────

mod counter_contract {
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    pub struct Counter;

    #[contractimpl]
    impl Counter {
        pub fn increment(env: Env) -> i64 {
            let val: i64 = env
                .storage()
                .instance()
                .get::<_, i64>(&soroban_sdk::symbol_short!("val"))
                .unwrap_or(0);
            let new_val = val + 1;
            env.storage()
                .instance()
                .set(&soroban_sdk::symbol_short!("val"), &new_val);
            new_val
        }

        pub fn get(env: Env) -> i64 {
            env.storage()
                .instance()
                .get::<_, i64>(&soroban_sdk::symbol_short!("val"))
                .unwrap_or(0)
        }
    }
}

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let caller = Address::generate(&env);
    let executor = env.register_contract(None, BundleExecutor);
    (env, caller, executor)
}

#[test]
fn test_validate_empty_bundle_fails() {
    let (env, _caller, executor) = setup();
    let client = BundleExecutorClient::new(&env, &executor);
    let result = client.try_validate(&vec![&env], &vec![&env]);
    assert_eq!(result, Err(Ok(Error::EmptyBundle)));
}

#[test]
fn test_validate_too_many_calls_fails() {
    let (env, _caller, executor) = setup();
    let client = BundleExecutorClient::new(&env, &executor);

    let dummy_contract = Address::generate(&env);
    let mut calls: Vec<Call> = vec![&env];
    for _ in 0..26 {
        calls.push_back(Call {
            contract: dummy_contract.clone(),
            function: Symbol::new(&env, "noop"),
            args: vec![&env],
        });
    }
    let result = client.try_validate(&calls, &vec![&env]);
    assert_eq!(result, Err(Ok(Error::TooManyCalls)));
}

#[test]
fn test_validate_unknown_condition_kind_fails() {
    let (env, _caller, executor) = setup();
    let client = BundleExecutorClient::new(&env, &executor);

    let dummy_contract = Address::generate(&env);
    let calls: Vec<Call> = vec![
        &env,
        Call {
            contract: dummy_contract.clone(),
            function: Symbol::new(&env, "noop"),
            args: vec![&env],
        },
    ];
    let account = Address::generate(&env);
    let conditions: Vec<PostCondition> = vec![
        &env,
        PostCondition {
            kind: 99, // unknown
            token: dummy_contract.clone(),
            account,
            threshold: 0,
        },
    ];
    let result = client.try_validate(&calls, &conditions);
    assert_eq!(result, Err(Ok(Error::UnknownConditionKind)));
}

#[test]
fn test_validate_negative_threshold_fails() {
    let (env, _caller, executor) = setup();
    let client = BundleExecutorClient::new(&env, &executor);

    let dummy_contract = Address::generate(&env);
    let calls: Vec<Call> = vec![
        &env,
        Call {
            contract: dummy_contract.clone(),
            function: Symbol::new(&env, "noop"),
            args: vec![&env],
        },
    ];
    let account = Address::generate(&env);
    let conditions: Vec<PostCondition> = vec![
        &env,
        PostCondition {
            kind: KIND_MIN_BALANCE,
            token: dummy_contract.clone(),
            account,
            threshold: -100,
        },
    ];
    let result = client.try_validate(&calls, &conditions);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn test_validate_succeeds_for_valid_bundle() {
    let (env, _caller, executor) = setup();
    let client = BundleExecutorClient::new(&env, &executor);

    let dummy_contract = Address::generate(&env);
    let calls: Vec<Call> = vec![
        &env,
        Call {
            contract: dummy_contract.clone(),
            function: Symbol::new(&env, "noop"),
            args: vec![&env],
        },
    ];
    let count = client.validate(&calls, &vec![&env]);
    assert_eq!(count, 1);
}

#[test]
fn test_execute_single_call_bundle() {
    let env = Env::default();
    env.mock_all_auths();

    let executor = env.register_contract(None, BundleExecutor);
    let counter = env.register_contract(None, counter_contract::Counter);
    let caller = Address::generate(&env);

    let client = BundleExecutorClient::new(&env, &executor);

    let calls: Vec<Call> = vec![
        &env,
        Call {
            contract: counter.clone(),
            function: Symbol::new(&env, "increment"),
            args: vec![&env],
        },
    ];

    let result = client.execute(&caller, &calls, &vec![&env]);
    assert_eq!(result.calls_executed, 1);
    assert_eq!(result.conditions_checked, 0);
    assert!(result.success);

    // Verify counter was actually incremented
    let counter_client = counter_contract::CounterClient::new(&env, &counter);
    assert_eq!(counter_client.get(), 1);
}

#[test]
fn test_execute_multi_call_bundle() {
    let env = Env::default();
    env.mock_all_auths();

    let executor = env.register_contract(None, BundleExecutor);
    let counter = env.register_contract(None, counter_contract::Counter);
    let caller = Address::generate(&env);

    let client = BundleExecutorClient::new(&env, &executor);

    let calls: Vec<Call> = vec![
        &env,
        Call {
            contract: counter.clone(),
            function: Symbol::new(&env, "increment"),
            args: vec![&env],
        },
        Call {
            contract: counter.clone(),
            function: Symbol::new(&env, "increment"),
            args: vec![&env],
        },
        Call {
            contract: counter.clone(),
            function: Symbol::new(&env, "increment"),
            args: vec![&env],
        },
    ];

    let result = client.execute(&caller, &calls, &vec![&env]);
    assert_eq!(result.calls_executed, 3);
    assert!(result.success);

    let counter_client = counter_contract::CounterClient::new(&env, &counter);
    assert_eq!(counter_client.get(), 3);
}

#[test]
fn test_execute_empty_bundle_fails() {
    let (env, caller, executor) = setup();
    let client = BundleExecutorClient::new(&env, &executor);
    let result = client.try_execute(&caller, &vec![&env], &vec![&env]);
    assert_eq!(result, Err(Ok(Error::EmptyBundle)));
}
