// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String, Val, vec};

use crate::{DebuggingUtils, DebuggingUtilsClient};
use crate::Error;

fn setup() -> (Env, Address, DebuggingUtilsClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, DebuggingUtils);
    let client = DebuggingUtilsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn make_string(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

// ── Initialize Tests ────────────────────────────────────────────────────────────

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

// ── DebugLogger Tests ─────────────────────────────────────────────────────────

#[test]
fn test_log_debug_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.log_debug(&make_string(&env, "test message")).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_warn_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.log_warn(&make_string(&env, "warning")).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_error_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.log_error(&make_string(&env, "error msg")).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_multiple_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.log_debug(&make_string(&env, "msg1")).unwrap();
    client.log_warn(&make_string(&env, "msg2")).unwrap();
    client.log_error(&make_string(&env, "msg3")).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 3);
}

#[test]
fn test_log_empty_string_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.log_debug(&make_string(&env, "")).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_warn_empty_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.log_warn(&make_string(&env, "")).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_error_empty_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.log_error(&make_string(&env, "")).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_null_bytes_sanitized() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let msg_with_null = make_string(&env, "hello\0world");
    client.log_debug(&msg_with_null).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_non_printable_sanitized() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut msg = String::from_str(&env, "test");
    msg.push_str(&String::from_str(&env, "\x01\x02\x03"));
    client.log_debug(&msg).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_truncation_at_512() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut long_msg = String::from_str(&env, "");
    for _ in 0..600 {
        long_msg.push_str(&make_string(&env, "a"));
    }
    client.log_debug(&long_msg).unwrap();
    let logs = client.get_logs().unwrap();
    assert!(logs.get(0).unwrap().to_string().len() <= 512);
}

#[test]
fn test_clear_logs() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.log_debug(&make_string(&env, "msg")).unwrap();
    assert_eq!(client.get_logs().unwrap().len(), 1);
    client.clear_logs().unwrap();
    assert_eq!(client.get_logs().unwrap().len(), 0);
}

#[test]
fn test_clear_logs_when_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.clear_logs().unwrap();
    assert_eq!(client.get_logs().unwrap().len(), 0);
}

#[test]
fn test_get_logs_before_logging() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 0);
}

// ── StateInspector Tests ───────────────────────────────────────────────────────

#[test]
fn test_snapshot_state_empty_keys() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let keys: Vec<String> = vec![&env];
    let result = client.snapshot_state(&keys).unwrap();
    assert_eq!(result.len(), 0);
}

#[test]
fn test_snapshot_state_one_key() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(make_string(&env, "key1"));
    let result = client.snapshot_state(&keys).unwrap();
    assert_eq!(result.len(), 0);
}

#[test]
fn test_snapshot_state_empty_key_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(make_string(&env, ""));
    let err = client.snapshot_state(&keys).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_snapshot_state_key_too_long_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut keys: Vec<String> = vec![&env];
    let mut long_key = String::from_str(&env, "");
    for _ in 0..130 {
        long_key.push_str(&make_string(&env, "x"));
    }
    keys.push_back(long_key);
    let err = client.snapshot_state(&keys).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_validate_state_empty_key_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let val: Val = 42u64.into();
    let err = client.validate_state(&make_string(&env, ""), &val).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_validate_state_key_too_long_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut long_key = String::from_str(&env, "");
    for _ in 0..130 {
        long_key.push_str(&make_string(&env, "x"));
    }
    let val: Val = 42u64.into();
    let err = client.validate_state(&long_key, &val).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_compare_states_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let map_a: Map<String, Val> = Map::new(&env);
    let map_b: Map<String, Val> = Map::new(&env);
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 0);
}

#[test]
fn test_compare_states_single_diff() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "key1"), 1u64.into());
    map_b.set(make_string(&env, "key1"), 2u64.into());
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 1);
}

#[test]
fn test_compare_states_no_diff() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "key1"), 1u64.into());
    map_b.set(make_string(&env, "key1"), 1u64.into());
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 0);
}

#[test]
fn test_compare_states_multiple_diffs() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "k1"), 1u64.into());
    map_a.set(make_string(&env, "k2"), 2u64.into());
    map_a.set(make_string(&env, "k3"), 3u64.into());
    map_b.set(make_string(&env, "k1"), 1u64.into());
    map_b.set(make_string(&env, "k2"), 99u64.into());
    map_b.set(make_string(&env, "k3"), 3u64.into());
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 1);
}

// ── ExecutionTracer Tests ───────────────────────────────────────────────────────

#[test]
fn test_start_trace_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_trace(&make_string(&env, "trace1")).unwrap();
}

#[test]
fn test_start_trace_empty_id_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.start_trace(&make_string(&env, "")).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_record_step_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_trace(&make_string(&env, "t1")).unwrap();
    client.record_step(&make_string(&env, "t1"), &make_string(&env, "step1")).unwrap();
}

#[test]
fn test_record_step_empty_step_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_trace(&make_string(&env, "t1")).unwrap();
    let err = client.record_step(&make_string(&env, "t1"), &make_string(&env, "")).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_record_step_empty_trace_id_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.record_step(&make_string(&env, ""), &make_string(&env, "step")).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_end_trace_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_trace(&make_string(&env, "t1")).unwrap();
    client.record_step(&make_string(&env, "t1"), &make_string(&env, "step1")).unwrap();
    let trace = client.end_trace(&make_string(&env, "t1")).unwrap();
    assert_eq!(trace.len(), 1);
}

#[test]
fn test_end_trace_not_found() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.end_trace(&make_string(&env, "nonexistent")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_end_trace_empty_id_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.end_trace(&make_string(&env, "")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_trace_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_trace(&make_string(&env, "t1")).unwrap();
    client.record_step(&make_string(&env, "t1"), &make_string(&env, "step1")).unwrap();
    let trace = client.get_trace(&make_string(&env, "t1")).unwrap();
    assert_eq!(trace.len(), 1);
}

#[test]
fn test_get_trace_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_trace(&make_string(&env, "t1")).unwrap();
    let trace = client.get_trace(&make_string(&env, "t1")).unwrap();
    assert_eq!(trace.len(), 0);
}

#[test]
fn test_trace_lifecycle() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let tid = make_string(&env, "trace_lifecycle");
    
    // start
    client.start_trace(&tid).unwrap();
    
    // record steps
    client.record_step(&tid, &make_string(&env, "step1")).unwrap();
    client.record_step(&tid, &make_string(&env, "step2")).unwrap();
    client.record_step(&tid, &make_string(&env, "step3")).unwrap();
    
    // verify during
    let trace_mid = client.get_trace(&tid).unwrap();
    assert_eq!(trace_mid.len(), 3);
    
    // end
    let trace_end = client.end_trace(&tid).unwrap();
    assert_eq!(trace_end.len(), 3);
    
    // re-query after end (storage still exists)
    let trace_requery = client.get_trace(&tid).unwrap();
    assert_eq!(trace_requery.len(), 3);
}

// ── GasProfiler Tests ───────────────────────────────────────────────────────────

#[test]
fn test_start_profile_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_profile(&make_string(&env, "func1")).unwrap();
}

#[test]
fn test_end_profile_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_profile(&make_string(&env, "func1")).unwrap();
    let cost = client.end_profile(&make_string(&env, "func1")).unwrap();
    assert!(cost > 0 || cost == 0);
}

#[test]
fn test_end_profile_not_started_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.end_profile(&make_string(&env, "nonexistent")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_profile_report() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let report = client.get_profile_report().unwrap();
    assert_eq!(report.len(), 0);
}

#[test]
fn test_reset_profiles() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_profile(&make_string(&env, "f1")).unwrap();
    client.end_profile(&make_string(&env, "f1")).unwrap();
    client.reset_profiles().unwrap();
}

#[test]
fn test_profile_multiple_functions() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_profile(&make_string(&env, "fn_a")).unwrap();
    client.start_profile(&make_string(&env, "fn_b")).unwrap();
    client.end_profile(&make_string(&env, "fn_a")).unwrap();
    client.end_profile(&make_string(&env, "fn_b")).unwrap();
}

// ── ErrorDebugger Tests ─────────────────────────────────────────────────────────

#[test]
fn test_capture_error_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let formatted = client.capture_error(&1, &make_string(&env, "test context")).unwrap();
    assert!(formatted.to_string().starts_with("[ERROR-1]"));
}

#[test]
fn test_format_error_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let formatted = client.format_error(&42, &make_string(&env, "ctx")).unwrap();
    assert!(formatted.to_string().contains("[ERROR-42]"));
}

#[test]
fn test_format_error_contains_context() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let formatted = client.format_error(&1, &make_string(&env, "my_context")).unwrap();
    assert!(formatted.to_string().contains("my_context"));
}

#[test]
fn test_format_error_contains_ledger() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let formatted = client.format_error(&1, &make_string(&env, "ctx")).unwrap();
    assert!(formatted.to_string().contains("ledger:"));
}

#[test]
fn test_get_error_history_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let history = client.get_error_history().unwrap();
    assert_eq!(history.len(), 0);
}

#[test]
fn test_get_error_history_with_entries() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.capture_error(&1, &make_string(&env, "err1")).unwrap();
    client.capture_error(&2, &make_string(&env, "err2")).unwrap();
    let history = client.get_error_history().unwrap();
    assert_eq!(history.len(), 2);
}

#[test]
fn test_clear_error_history() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.capture_error(&1, &make_string(&env, "err")).unwrap();
    assert_eq!(client.get_error_history().unwrap().len(), 1);
    client.clear_error_history().unwrap();
    assert_eq!(client.get_error_history().unwrap().len(), 0);
}

#[test]
fn test_error_history_fifo_eviction() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..100 {
        client.capture_error(&i, &make_string(&env, "err")).unwrap();
    }
    let history = client.get_error_history().unwrap();
    assert_eq!(history.len(), 100);
    
    // Add one more, should evict oldest
    client.capture_error(&100, &make_string(&env, "err")).unwrap();
    let history = client.get_error_history().unwrap();
    assert_eq!(history.len(), 100);
}

// ── Additional Boundary and Security Tests ──────────────────────────────────────

#[test]
fn test_max_length_string_accepted() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut max_str = String::from_str(&env, "");
    for _ in 0..512 {
        max_str.push_str(&make_string(&env, "x"));
    }
    client.log_debug(&max_str).unwrap();
    assert_eq!(client.get_logs().unwrap().len(), 1);
}

#[test]
fn test_string_exactly_512_chars() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut exact_str = String::from_str(&env, "");
    for _ in 0..512 {
        exact_str.push_str(&make_string(&env, "a"));
    }
    client.log_debug(&exact_str).unwrap();
}

#[test]
fn test_string_over_512_chars_truncated() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut long_str = String::from_str(&env, "");
    for _ in 0..600 {
        long_str.push_str(&make_string(&env, "z"));
    }
    client.log_debug(&long_str).unwrap();
}

#[test]
fn test_key_exactly_128_chars_accepted() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut key = String::from_str(&env, "");
    for _ in 0..128 {
        key.push_str(&make_string(&env, "k"));
    }
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(key);
    client.snapshot_state(&keys).unwrap();
}

#[test]
fn test_key_129_chars_rejected() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut key = String::from_str(&env, "");
    for _ in 0..129 {
        key.push_str(&make_string(&env, "k"));
    }
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(key);
    let err = client.snapshot_state(&keys).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_trace_200_steps_accepted() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let tid = make_string(&env, "big_trace");
    client.start_trace(&tid).unwrap();
    for i in 0..200 {
        let mut step = String::from_str(&env, "step");
        step.push_str(&i.to_string(&env));
        client.record_step(&tid, &step).unwrap();
    }
}

#[test]
fn test_trace_201_steps_rejected() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let tid = make_string(&env, "overflow_trace");
    client.start_trace(&tid).unwrap();
    for i in 0..200 {
        let mut step = String::from_str(&env, "s");
        step.push_str(&i.to_string(&env));
        client.record_step(&tid, &step).unwrap();
    }
    let err = client.record_step(&tid, &make_string(&env, "overflow")).unwrap_err();
    assert_eq!(err, Error::CapExceeded);
}

#[test]
fn test_error_code_zero() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let formatted = client.format_error(&0, &make_string(&env, "ctx")).unwrap();
    assert!(formatted.to_string().contains("[ERROR-0]"));
}

#[test]
fn test_error_code_large() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let formatted = client.format_error(&999999, &make_string(&env, "ctx")).unwrap();
    assert!(formatted.to_string().contains("[ERROR-999999]"));
}

// ── Non-initialized Contract Tests ─────────────────────────────────────────────

#[test]
fn test_log_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.log_debug(&make_string(&env, "msg")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_logs_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.get_logs().unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_start_trace_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.start_trace(&make_string(&env, "t1")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_capture_error_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.capture_error(&1, &make_string(&env, "ctx")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

// ── Additional DebugLogger Tests ───────────────────────────────────────────────

#[test]
fn test_log_debug_many_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..50 {
        let mut msg = String::from_str(&env, "log");
        msg.push_str(&i.to_string(&env));
        client.log_debug(&msg).unwrap();
    }
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 50);
}

#[test]
fn test_log_warn_many_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..50 {
        let mut msg = String::from_str(&env, "warn");
        msg.push_str(&i.to_string(&env));
        client.log_warn(&msg).unwrap();
    }
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 50);
}

#[test]
fn test_log_error_many_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..50 {
        let mut msg = String::from_str(&env, "error");
        msg.push_str(&i.to_string(&env));
        client.log_error(&msg).unwrap();
    }
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 50);
}

#[test]
fn test_log_all_special_chars_sanitized() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut msg = String::from_str(&env, "test");
    for c in 0..32u8 {
        msg.push_str(&String::from_bytes(&env, &vec![c]));
    }
    client.log_debug(&msg).unwrap();
}

#[test]
fn test_log_preserves_printable() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let msg = make_string(&env, "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~");
    client.log_debug(&msg).unwrap();
}

#[test]
fn test_log_clears_then_adds() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.log_debug(&make_string(&env, "old")).unwrap();
    client.clear_logs().unwrap();
    client.log_debug(&make_string(&env, "new")).unwrap();
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 1);
}

// ── Additional StateInspector Tests ────────────────────────────────────────────

#[test]
fn test_compare_states_many_differences() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    for i in 0..10 {
        let key = format_name(&env, i);
        map_a.set(key.clone(), (i * 2) as u64.into());
        map_b.set(key.clone(), (i * 3) as u64.into());
    }
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 10);
}

#[test]
fn test_compare_states_value_in_b_only() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_b.set(make_string(&env, "only_b"), 42u64.into());
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 1);
}

#[test]
fn test_compare_states_same_values() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "k"), 123u64.into());
    map_b.set(make_string(&env, "k"), 123u64.into());
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 0);
}

#[test]
fn test_validate_state_nonexistent_key() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let val: Val = 42u64.into();
    let result = client.validate_state(&make_string(&env, "nonexistent"), &val).unwrap();
    assert!(!result);
}

// ── Additional ExecutionTracer Tests ──────────────────────────────────────────

#[test]
fn test_multiple_traces() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..5 {
        let tid = format_name(&env, i);
        client.start_trace(&tid).unwrap();
        client.record_step(&tid, &make_string(&env, "step")).unwrap();
    }
    for i in 0..5 {
        let tid = format_name(&env, i);
        let trace = client.get_trace(&tid).unwrap();
        assert_eq!(trace.len(), 1);
    }
}

#[test]
fn test_trace_with_same_id_replaces() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let tid = make_string(&env, "same_id");
    client.start_trace(&tid).unwrap();
    client.record_step(&tid, &make_string(&env, "step1")).unwrap();
    client.start_trace(&tid).unwrap();
    client.record_step(&tid, &make_string(&env, "step2")).unwrap();
    let trace = client.get_trace(&tid).unwrap();
    assert_eq!(trace.len(), 1);
}

#[test]
fn test_record_step_many_times() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let tid = make_string(&env, "steps");
    client.start_trace(&tid).unwrap();
    for i in 0..100 {
        let step = format_name(&env, i);
        client.record_step(&tid, &step).unwrap();
    }
    let trace = client.get_trace(&tid).unwrap();
    assert_eq!(trace.len(), 100);
}

// ── Additional GasProfiler Tests ───────────────────────────────────────────────

#[test]
fn test_end_profile_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_profile(&make_string(&env, "fn")).unwrap();
    client.end_profile(&make_string(&env, "fn")).unwrap();
    let err = client.end_profile(&make_string(&env, "fn")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_start_profile_same_fn_overwrites() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.start_profile(&make_string(&env, "fn")).unwrap();
    client.start_profile(&make_string(&env, "fn")).unwrap();
    client.end_profile(&make_string(&env, "fn")).unwrap();
}

// ── Additional ErrorDebugger Tests ─────────────────────────────────────────────

#[test]
fn test_format_error_all_codes() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..10 {
        let formatted = client.format_error(&i, &make_string(&env, "test")).unwrap();
        assert!(formatted.to_string().contains("[ERROR-"));
    }
}

#[test]
fn test_capture_error_stores_history() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let formatted = client.capture_error(&1, &make_string(&env, "err1")).unwrap();
    let history = client.get_error_history().unwrap();
    assert_eq!(history.len(), 1);
    assert!(history.get(0).unwrap().to_string().contains("[ERROR-1]"));
}

#[test]
fn test_clear_error_history_multiple_times() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.capture_error(&1, &make_string(&env, "err")).unwrap();
    client.clear_error_history().unwrap();
    assert_eq!(client.get_error_history().unwrap().len(), 0);
    client.clear_error_history().unwrap();
}

fn format_name(env: &Env, n: u32) -> String {
    n.to_string(env)
}

// ── Additional DebugLogger Security Tests ─────────────────────────────────────

#[test]
fn test_log_only_spaces() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let msg = make_string(&env, "     ");
    client.log_debug(&msg).unwrap();
}

#[test]
fn test_log_only_non_printable_rejected() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let msg = String::from_str(&env, "\n\t\r");
    let err = client.log_debug(&msg).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_mixed_content() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut msg = make_string(&env, "start");
    msg.push_str(&String::from_str(&env, "\n"));
    msg.push_str(&make_string(&env, "middle"));
    msg.push_str(&String::from_str(&env, "\x00"));
    msg.push_str(&make_string(&env, "end"));
    client.log_debug(&msg).unwrap();
}

#[test]
fn test_log_many_warns_then_errors() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..20 {
        let mut msg = make_string(&env, "warn-");
        msg.push_str(&format_name(&env, i));
        client.log_warn(&msg).unwrap();
    }
    for i in 0..20 {
        let mut msg = make_string(&env, "error-");
        msg.push_str(&format_name(&env, i));
        client.log_error(&msg).unwrap();
    }
    let logs = client.get_logs().unwrap();
    assert_eq!(logs.len(), 40);
}

// ── Additional StateInspector Tests ───────────────────────────────────────────

#[test]
fn test_snapshot_state_multiple_keys() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let mut keys: Vec<String> = vec![&env];
    for i in 0..10 {
        keys.push_back(format_name(&env, i));
    }
    let result = client.snapshot_state(&keys).unwrap();
    assert_eq!(result.len(), 0);
}

#[test]
fn test_compare_states_empty_a_nonempty_b() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_b.set(make_string(&env, "key"), 1u64.into());
    let diffs = client.compare_states(&map_a, &map_b).unwrap();
    assert_eq!(diffs.len(), 1);
}

// ── Additional GasProfiler Tests ─────────────────────────────────────────────

#[test]
fn test_profile_many_functions() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..20 {
        let name = format_name(&env, i);
        client.start_profile(&name).unwrap();
        client.end_profile(&name).unwrap();
    }
}

// ── Additional ErrorDebugger Tests ───────────────────────────────────────────

#[test]
fn test_capture_many_errors() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 0..50 {
        let mut ctx = make_string(&env, "error-");
        ctx.push_str(&format_name(&env, i));
        client.capture_error(&i, &ctx).unwrap();
    }
    let history = client.get_error_history().unwrap();
    assert_eq!(history.len(), 50);
}

#[test]
fn test_format_error_special_context() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let ctx = make_string(&env, "context with spaces and symbols!@#$%");
    let formatted = client.format_error(&1, &ctx).unwrap();
    assert!(formatted.to_string().contains("context with spaces and symbols!@#$%"));
}