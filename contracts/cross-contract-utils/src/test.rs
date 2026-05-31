#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String, Val, vec};

use crate::{CrossContractUtils, CrossContractUtilsClient};
use crate::Error;

fn setup() -> (Env, Address, CrossContractUtilsClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, CrossContractUtils);
    let client = CrossContractUtilsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn make_string(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn make_address(env: &Env) -> Address {
    Address::generate(env)
}

// ── Initialize Tests ───────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
}

#[test]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.initialize(&admin).unwrap_err();
    assert_eq!(err, Error::CapExceeded);
}

// ── CrossContractCaller Tests ─────────────────────────────────────────────────

#[test]
fn test_call_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    let result = client.call(&env, &contract, &make_string(&env, "fn"), &args).unwrap();
    assert!(result == Val::VOID);
}

#[test]
fn test_call_fn_name_empty_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    let err = client.call(&env, &contract, &make_string(&env, ""), &args).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_call_fn_name_too_long_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let mut long_name = String::from_str(&env, "");
    for _ in 0..65 {
        long_name.push_str(&make_string(&env, "a"));
    }
    let args: Vec<Val> = vec![&env];
    let err = client.call(&env, &contract, &long_name, &args).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_call_args_exceed_20_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let mut args: Vec<Val> = vec![&env];
    for _ in 0..21 {
        args.push_back(1u64.into());
    }
    let err = client.call(&env, &contract, &make_string(&env, "fn"), &args).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_call_args_exactly_20_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let mut args: Vec<Val> = vec![&env];
    for _ in 0..20 {
        args.push_back(1u64.into());
    }
    client.call(&env, &contract, &make_string(&env, "fn"), &args).unwrap();
}

#[test]
fn test_call_with_retry_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    let result = client.call_with_retry(&env, &contract, &make_string(&env, "fn"), &args, &0).unwrap();
    assert!(result.is_ok());
}

#[test]
fn test_call_with_retry_max_5_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    client.call_with_retry(&env, &contract, &make_string(&env, "fn"), &args, &5).unwrap();
}

#[test]
fn test_call_with_retry_max_6_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    let err = client.call_with_retry(&env, &contract, &make_string(&env, "fn"), &args, &6).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_call_readonly_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    client.call_readonly(&env, &contract, &make_string(&env, "fn"), &args).unwrap();
}

#[test]
fn test_call_readonly_fn_empty_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    let err = client.call_readonly(&env, &contract, &make_string(&env, ""), &args).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

// ── ContractRegistry Tests ───────────────────────────────────────────────────

#[test]
fn test_register_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    client.register(&admin, &make_string(&env, "my-contract"), &contract).unwrap();
}

#[test]
fn test_register_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let other = Address::generate(&env);
    env.mock_all_auths();
    let err = client.register(&other, &make_string(&env, "contract"), &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_register_empty_name_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.register(&admin, &make_string(&env, ""), &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_register_name_too_long_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut long_name = String::from_str(&env, "");
    for _ in 0..65 {
        long_name.push_str(&make_string(&env, "a"));
    }
    let err = client.register(&admin, &long_name, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_register_invalid_chars_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.register(&admin, &make_string(&env, "invalid_name!"), &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_register_valid_names() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.register(&admin, &make_string(&env, "contract-a")).unwrap();
    client.register(&admin, &make_string(&env, "contractB")).unwrap();
    client.register(&admin, &make_string(&env, "ContractC")).unwrap();
}

#[test]
fn test_deregister_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    client.register(&admin, &make_string(&env, "to-delete"), &contract).unwrap();
    client.deregister(&admin, &make_string(&env, "to-delete")).unwrap();
}

#[test]
fn test_deregister_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.register(&admin, &make_string(&env, "c1"), &make_address(&env)).unwrap();
    let other = Address::generate(&env);
    env.mock_all_auths();
    let err = client.deregister(&other, &make_string(&env, "c1")).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_lookup_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    client.register(&admin, &make_string(&env, "lookup-test"), &contract).unwrap();
    let found = client.lookup(&env, &make_string(&env, "lookup-test")).unwrap();
    assert_eq!(found, contract);
}

#[test]
fn test_lookup_not_found() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.lookup(&env, &make_string(&env, "nonexistent")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_lookup_empty_name_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.lookup(&env, &make_string(&env, "")).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_list_all_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let list = client.list_all(&env);
    assert_eq!(list.len(), 0);
}

#[test]
fn test_verify_interface_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let fn_names: Vec<String> = vec![&env, make_string(&env, "fn1")];
    let valid = client.verify_interface(&env, &contract, &fn_names).unwrap();
    assert!(valid);
}

#[test]
fn test_registry_cap_at_100() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..100 {
        let name = format_name(&env, i);
        client.register(&admin, &name, &make_address(&env)).unwrap();
    }
}

#[test]
fn test_registry_cap_101_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..100 {
        let name = format_name(&env, i);
        client.register(&admin, &name, &make_address(&env)).unwrap();
    }
    let name = format_name(&env, 100);
    let err = client.register(&admin, &name, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::CapExceeded);
}

// ── CallValidator Tests ─────────────────────────────────────────────────────

#[test]
fn test_validate_address_valid() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_address(&env, &make_address(&env)).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_address_zero() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let zero = Address::from_literal("00000000000000000000000000000000000000000000000000000000000000000");
    let valid = client.validate_address(&env, &zero).unwrap();
    assert!(!valid);
}

#[test]
fn test_validate_function_signature_valid() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_function_signature(&env, &make_string(&env, "my_function"), &2).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_function_signature_empty_fn() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_function_signature(&env, &make_string(&env, ""), &0).unwrap();
    assert!(!valid);
}

#[test]
fn test_validate_function_signature_args_at_limit() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_function_signature(&env, &make_string(&env, "fn"), &20).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_function_signature_args_exceed() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_function_signature(&env, &make_string(&env, "fn"), &21).unwrap();
    assert!(!valid);
}

#[test]
fn test_validate_return_type_u64() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_return_type_fn(&env, 42u64.into(), &make_string(&env, "u64")).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_return_type_i128() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_return_type_fn(&env, 100i128.into(), &make_string(&env, "i128")).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_return_type_bool() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_return_type_fn(&env, true.into(), &make_string(&env, "bool")).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_return_type_string() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_return_type_fn(&env, make_string(&env, "test").into(), &make_string(&env, "string")).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_return_type_address() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_return_type_fn(&env, make_address(&env).into(), &make_string(&env, "address")).unwrap();
    assert!(valid);
}

#[test]
fn test_validate_return_type_invalid() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_return_type_fn(&env, 42u64.into(), &make_string(&env, "invalid_type")).unwrap();
    assert!(!valid);
}

// ── BatchCaller Tests ───────────────────────────────────────────────────────

#[test]
fn test_batch_call_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    let results = client.batch_call(&env, &calls).unwrap();
    assert_eq!(results.len(), 0);
}

#[test]
fn test_batch_call_one() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    calls.push_back((make_address(&env), make_string(&env, "fn1"), vec![&env]));
    let results = client.batch_call(&env, &calls).unwrap();
    assert_eq!(results.len(), 1);
}

#[test]
fn test_batch_call_ten() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    for i in 0..10 {
        calls.push_back((make_address(&env), format_name(&env, i), vec![&env]));
    }
    let results = client.batch_call(&env, &calls).unwrap();
    assert_eq!(results.len(), 10);
}

#[test]
fn test_batch_call_eleven_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    for i in 0..11 {
        calls.push_back((make_address(&env), format_name(&env, i), vec![&env]));
    }
    let err = client.batch_call(&env, &calls).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_atomic_batch_call_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    let results = client.atomic_batch_call(&env, &calls).unwrap();
    assert_eq!(results.len(), 0);
}

#[test]
fn test_atomic_batch_call_one() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    calls.push_back((make_address(&env), make_string(&env, "fn1"), vec![&env]));
    let results = client.atomic_batch_call(&env, &calls).unwrap();
    assert_eq!(results.len(), 1);
}

#[test]
fn test_atomic_batch_call_ten() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    for i in 0..10 {
        calls.push_back((make_address(&env), format_name(&env, i), vec![&env]));
    }
    let results = client.atomic_batch_call(&env, &calls).unwrap();
    assert_eq!(results.len(), 10);
}

#[test]
fn test_atomic_batch_call_eleven_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    for i in 0..11 {
        calls.push_back((make_address(&env), format_name(&env, i), vec![&env]));
    }
    let err = client.atomic_batch_call(&env, &calls).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

// ── FallbackHandler Tests ─────────────────────────────────────────────────────

#[test]
fn test_register_fallback_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let fallback = make_address(&env);
    client.register_fallback(&admin, &contract, &fallback).unwrap();
}

#[test]
fn test_register_fallback_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let other = Address::generate(&env);
    env.mock_all_auths();
    let err = client.register_fallback(&other, &make_address(&env), &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_get_fallback_exists() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let fallback = make_address(&env);
    client.register_fallback(&admin, &contract, &fallback).unwrap();
    let result = client.get_fallback(&env, &contract).unwrap();
    assert!(result.is_some());
}

#[test]
fn test_get_fallback_not_exists() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let result = client.get_fallback(&env, &make_address(&env)).unwrap();
    assert!(result.is_none());
}

#[test]
fn test_remove_fallback_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let fallback = make_address(&env);
    client.register_fallback(&admin, &contract, &fallback).unwrap();
    client.remove_fallback(&admin, &contract).unwrap();
    let result = client.get_fallback(&env, &contract).unwrap();
    assert!(result.is_none());
}

#[test]
fn test_remove_fallback_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.register_fallback(&admin, &make_address(&env), &make_address(&env)).unwrap();
    let other = Address::generate(&env);
    env.mock_all_auths();
    let err = client.remove_fallback(&other, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_call_with_fallback_primary_succeeds() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let primary = make_address(&env);
    let fallback = make_address(&env);
    let args: Vec<Val> = vec![&env];
    let result = client.call_with_fallback(&env, &primary, &fallback, &make_string(&env, "fn"), &args).unwrap();
}

// ── Non-Initialized Tests ─────────────────────────────────────────────────────

#[test]
fn test_call_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.call(&env, &make_address(&env), &make_string(&env, "fn"), &vec![&env]).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_register_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.register(&_admin, &make_string(&env, "name"), &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_validate_address_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.validate_address(&env, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

fn format_name(env: &Env, n: u32) -> String {
    let bytes = n.to_string(&env).to_bytes();
    String::from_bytes(env, &bytes)
}

// ── Additional CrossContractCaller Tests ──────────────────────────────────────

#[test]
fn test_call_fn_name_exactly_64_chars() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let mut name = String::from_str(&env, "");
    for _ in 0..64 {
        name.push_str(&make_string(&env, "a"));
    }
    let args: Vec<Val> = vec![&env];
    client.call(&env, &contract, &name, &args).unwrap();
}

#[test]
fn test_call_fn_name_65_chars_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let mut name = String::from_str(&env, "");
    for _ in 0..65 {
        name.push_str(&make_string(&env, "a"));
    }
    let args: Vec<Val> = vec![&env];
    let err = client.call(&env, &contract, &name, &args).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_call_with_retry_zero_retries() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    client.call_with_retry(&env, &contract, &make_string(&env, "fn"), &args, &0).unwrap();
}

#[test]
fn test_call_with_retry_one_retry() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let args: Vec<Val> = vec![&env];
    client.call_with_retry(&env, &contract, &make_string(&env, "fn"), &args, &1).unwrap();
}

// ── Additional Registry Tests ─────────────────────────────────────────────────

#[test]
fn test_deregister_nonexistent_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.deregister(&admin, &make_string(&env, "nonexistent")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_register_duplicate_name() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract1 = make_address(&env);
    let contract2 = make_address(&env);
    client.register(&admin, &make_string(&env, "same"), &contract1).unwrap();
    // Registering same name again should succeed (no check for existing)
    client.register(&admin, &make_string(&env, "same"), &contract2).unwrap();
}

#[test]
fn test_lookup_name_too_long_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut name = String::from_str(&env, "");
    for _ in 0..65 {
        name.push_str(&make_string(&env, "a"));
    }
    let err = client.lookup(&env, &name).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

// ── Additional CallValidator Tests ───────────────────────────────────────────

#[test]
fn test_validate_return_type_multiple_values() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let valid = client.validate_return_type_fn(&env, 42u64.into(), &make_string(&env, "u64")).unwrap();
    assert!(valid);
    let valid = client.validate_return_type_fn(&env, 3.14f64.into(), &make_string(&env, "i128")).unwrap();
    assert!(!valid);
}

// ── Additional BatchCaller Tests ───────────────────────────────────────────────

#[test]
fn test_batch_call_partial_results() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    calls.push_back((make_address(&env), make_string(&env, "fn1"), vec![&env]));
    calls.push_back((make_address(&env), make_string(&env, "fn2"), vec![&env]));
    calls.push_back((make_address(&env), make_string(&env, "fn3"), vec![&env]));
    let results = client.batch_call(&env, &calls).unwrap();
    assert_eq!(results.len(), 3);
}

// ── Additional FallbackHandler Tests ───────────────────────────────────────────

#[test]
fn test_register_fallback_multiple() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for _ in 0..5 {
        client.register_fallback(&admin, &make_address(&env), &make_address(&env)).unwrap();
    }
}

#[test]
fn test_call_with_fallback_different_fns() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let primary = make_address(&env);
    let fallback = make_address(&env);
    for fn_name in ["fn_a", "fn_b", "fn_c"].iter() {
        let args: Vec<Val> = vec![&env];
        let _ = client.call_with_fallback(&env, &primary, &fallback, &make_string(&env, fn_name), &args);
    }
}

// ── Additional Non-Initialized Tests ───────────────────────────────────────────

#[test]
fn test_batch_call_before_init_fails() {
    let (env, _admin, client) = setup();
    let calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    let err = client.batch_call(&env, &calls).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_atomic_batch_call_before_init_fails() {
    let (env, _admin, client) = setup();
    let calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
    let err = client.atomic_batch_call(&env, &calls).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_verify_interface_before_init_fails() {
    let (env, _admin, client) = setup();
    let fn_names: Vec<String> = vec![&env];
    let err = client.verify_interface(&env, &make_address(&env), &fn_names).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

// ── Additional CrossContractCaller Tests ───────────────────────────────────────

#[test]
fn test_call_with_many_args() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let contract = make_address(&env);
    let mut args: Vec<Val> = vec![&env];
    for i in 0..20 {
        args.push_back(i.into());
    }
    client.call(&env, &contract, &make_string(&env, "fn"), &args).unwrap();
}

#[test]
fn test_call_readonly_empty_args() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.call_readonly(&env, &make_address(&env), &make_string(&env, "fn"), &vec![&env]).unwrap();
}

#[test]
fn test_call_readonly_many_args() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut args: Vec<Val> = vec![&env];
    for i in 0..20 {
        args.push_back(i.into());
    }
    client.call_readonly(&env, &make_address(&env), &make_string(&env, "fn"), &args).unwrap();
}

// ── Additional BatchCaller Tests ───────────────────────────────────────────────

#[test]
fn test_batch_call_various_sizes() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for size in 1..=10 {
        let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
        for i in 0..size {
            calls.push_back((make_address(&env), format_name(&env, i), vec![&env]));
        }
        let results = client.batch_call(&env, &calls).unwrap();
        assert_eq!(results.len(), size as u32);
    }
}

#[test]
fn test_atomic_batch_call_various_sizes() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for size in 1..=10 {
        let mut calls: Vec<(Address, String, Vec<Val>)> = vec![&env];
        for i in 0..size {
            calls.push_back((make_address(&env), format_name(&env, i), vec![&env]));
        }
        let results = client.atomic_batch_call(&env, &calls).unwrap();
        assert_eq!(results.len(), size as u32);
    }
}

// ── Additional CallValidator Tests ───────────────────────────────────────────

#[test]
fn test_validate_return_type_all_types() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    // Test all valid types
    assert!(client.validate_return_type_fn(&env, 1u64.into(), &make_string(&env, "u64")).unwrap());
    assert!(client.validate_return_type_fn(&env, 1i128.into(), &make_string(&env, "i128")).unwrap());
    assert!(client.validate_return_type_fn(&env, true.into(), &make_string(&env, "bool")).unwrap());
    assert!(client.validate_return_type_fn(&env, make_string(&env, "test").into(), &make_string(&env, "string")).unwrap());
    assert!(client.validate_return_type_fn(&env, make_address(&env).into(), &make_string(&env, "address")).unwrap());
}

#[test]
fn test_validate_return_type_invalid_types() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    // Test invalid types
    assert!(!client.validate_return_type_fn(&env, 1u64.into(), &make_string(&env, "invalid")).unwrap());
    assert!(!client.validate_return_type_fn(&env, 1u64.into(), &make_string(&env, "U64")).unwrap());
    assert!(!client.validate_return_type_fn(&env, 1u64.into(), &make_string(&env, "uint64")).unwrap());
}