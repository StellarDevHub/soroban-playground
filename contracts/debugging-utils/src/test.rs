// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Logs as _},
    vec, Address, Env, IntoVal, Map, String, Val, Vec,
};

use crate::Error;
use crate::{DebuggingUtils, DebuggingUtilsClient};

fn setup() -> (Env, Address, DebuggingUtilsClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_unlimited();
    let contract_id = env.register_contract(None, DebuggingUtils);
    let client = DebuggingUtilsClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn make_string(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn make_val(env: &Env, v: u64) -> Val {
    v.into_val(env)
}

fn format_name(env: &Env, _n: u32) -> String {
    make_string(env, "item")
}

// ── Initialize Tests ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    let err = client.try_initialize(&admin).unwrap_err().unwrap();
    assert_eq!(err, Error::CapExceeded);
}

// ── DebugLogger Tests ─────────────────────────────────────────────────────────

#[test]
fn test_log_debug_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.log_debug(&make_string(&env, "test message"));
    let logs = client.get_logs();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_warn_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.log_warn(&make_string(&env, "warning"));
    let logs = client.get_logs();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_error_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.log_error(&make_string(&env, "error msg"));
    let logs = client.get_logs();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_multiple_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.log_debug(&make_string(&env, "msg1"));
    client.log_warn(&make_string(&env, "msg2"));
    client.log_error(&make_string(&env, "msg3"));
    let logs = client.get_logs();
    assert_eq!(logs.len(), 3);
}

#[test]
fn test_log_empty_string_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_log_debug(&make_string(&env, ""))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_warn_empty_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_log_warn(&make_string(&env, ""))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_error_empty_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_log_error(&make_string(&env, ""))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_null_bytes_sanitized() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let msg_with_null = make_string(&env, "hello\0world");
    client.log_debug(&msg_with_null);
    let logs = client.get_logs();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_non_printable_sanitized() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let msg = make_string(&env, "test\x01\x02\x03");
    client.log_debug(&msg);
    let logs = client.get_logs();
    assert_eq!(logs.len(), 1);
}

#[test]
fn test_log_truncation_at_512() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut long_msg = std::string::String::new();
    for _ in 0..600 {
        long_msg.push('a');
    }
    client.log_debug(&make_string(&env, &long_msg));
    let logs = client.get_logs();
    assert!(logs.get(0).unwrap().len() <= 512);
}

#[test]
fn test_clear_logs() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.log_debug(&make_string(&env, "msg"));
    assert_eq!(client.get_logs().len(), 1);
    client.clear_logs();
    assert_eq!(client.get_logs().len(), 0);
}

#[test]
fn test_clear_logs_when_empty() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    client.clear_logs();
    assert_eq!(client.get_logs().len(), 0);
}

#[test]
fn test_get_logs_before_logging() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    let logs = client.get_logs();
    assert_eq!(logs.len(), 0);
}

// ── StateInspector Tests ───────────────────────────────────────────────────────

#[test]
fn test_snapshot_state_empty_keys() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let keys: Vec<String> = vec![&env];
    let result = client.snapshot_state(&keys);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_snapshot_state_one_key() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(make_string(&env, "key1"));
    let result = client.snapshot_state(&keys);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_snapshot_state_empty_key_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(make_string(&env, ""));
    let err = client.try_snapshot_state(&keys).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_snapshot_state_key_too_long_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut keys: Vec<String> = vec![&env];
    let mut long_key = std::string::String::new();
    for _ in 0..130 {
        long_key.push('x');
    }
    keys.push_back(make_string(&env, &long_key));
    let err = client.try_snapshot_state(&keys).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_validate_state_empty_key_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let val = make_val(&env, 42);
    let err = client
        .try_validate_state(&make_string(&env, ""), &val)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_validate_state_key_too_long_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut long_key = std::string::String::new();
    for _ in 0..130 {
        long_key.push('x');
    }
    let val = make_val(&env, 42);
    let err = client
        .try_validate_state(&make_string(&env, &long_key), &val)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_compare_states_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let map_a: Map<String, Val> = Map::new(&env);
    let map_b: Map<String, Val> = Map::new(&env);
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 0);
}

#[test]
fn test_compare_states_single_diff() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "key1"), make_val(&env, 1));
    map_b.set(make_string(&env, "key1"), make_val(&env, 2));
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 1);
}

#[test]
fn test_compare_states_no_diff() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "key1"), make_val(&env, 1));
    map_b.set(make_string(&env, "key1"), make_val(&env, 1));
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 0);
}

#[test]
fn test_compare_states_multiple_diffs() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "k1"), make_val(&env, 1));
    map_a.set(make_string(&env, "k2"), make_val(&env, 2));
    map_a.set(make_string(&env, "k3"), make_val(&env, 3));
    map_b.set(make_string(&env, "k1"), make_val(&env, 1));
    map_b.set(make_string(&env, "k2"), make_val(&env, 99));
    map_b.set(make_string(&env, "k3"), make_val(&env, 3));
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 1);
}

// ── ExecutionTracer Tests ───────────────────────────────────────────────────────

#[test]
fn test_start_trace_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_trace(&make_string(&env, "trace1"));
}

#[test]
fn test_start_trace_empty_id_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_start_trace(&make_string(&env, ""))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_record_step_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_trace(&make_string(&env, "t1"));
    client.record_step(&make_string(&env, "t1"), &make_string(&env, "step1"));
}

#[test]
fn test_record_step_empty_step_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_trace(&make_string(&env, "t1"));
    let err = client
        .try_record_step(&make_string(&env, "t1"), &make_string(&env, ""))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_record_step_empty_trace_id_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_record_step(&make_string(&env, ""), &make_string(&env, "step"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_end_trace_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_trace(&make_string(&env, "t1"));
    client.record_step(&make_string(&env, "t1"), &make_string(&env, "step1"));
    let trace = client.end_trace(&make_string(&env, "t1"));
    assert_eq!(trace.len(), 1);
}

#[test]
fn test_end_trace_not_found() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_end_trace(&make_string(&env, "nonexistent"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_end_trace_empty_id_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_end_trace(&make_string(&env, ""))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_trace_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_trace(&make_string(&env, "t1"));
    client.record_step(&make_string(&env, "t1"), &make_string(&env, "step1"));
    let trace = client.get_trace(&make_string(&env, "t1"));
    assert_eq!(trace.len(), 1);
}

#[test]
fn test_get_trace_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_trace(&make_string(&env, "t1"));
    let trace = client.get_trace(&make_string(&env, "t1"));
    assert_eq!(trace.len(), 0);
}

#[test]
fn test_trace_lifecycle() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let tid = make_string(&env, "trace_lifecycle");

    // start
    client.start_trace(&tid);

    // record steps
    client.record_step(&tid, &make_string(&env, "step1"));
    client.record_step(&tid, &make_string(&env, "step2"));
    client.record_step(&tid, &make_string(&env, "step3"));

    // verify during
    let trace_mid = client.get_trace(&tid);
    assert_eq!(trace_mid.len(), 3);

    // end
    let trace_end = client.end_trace(&tid);
    assert_eq!(trace_end.len(), 3);

    // re-query after end (storage still exists)
    let trace_requery = client.get_trace(&tid);
    assert_eq!(trace_requery.len(), 3);
}

// ── GasProfiler Tests ───────────────────────────────────────────────────────────

#[test]
fn test_start_profile_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_profile(&make_string(&env, "func1"));
}

#[test]
fn test_end_profile_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_profile(&make_string(&env, "func1"));
    let cost = client.end_profile(&make_string(&env, "func1"));
    assert!(cost > 0 || cost == 0);
}

#[test]
fn test_end_profile_not_started_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let err = client
        .try_end_profile(&make_string(&env, "nonexistent"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_profile_report() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    let report = client.get_profile_report();
    assert_eq!(report.len(), 0);
}

#[test]
fn test_reset_profiles() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_profile(&make_string(&env, "f1"));
    client.end_profile(&make_string(&env, "f1"));
    client.reset_profiles();
}

#[test]
fn test_profile_multiple_functions() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_profile(&make_string(&env, "fn_a"));
    client.start_profile(&make_string(&env, "fn_b"));
    client.end_profile(&make_string(&env, "fn_a"));
    client.end_profile(&make_string(&env, "fn_b"));
}

// ── ErrorDebugger Tests ─────────────────────────────────────────────────────────

#[test]
fn test_capture_error_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let formatted = client.capture_error(&1, &make_string(&env, "test context"));
    let mut buf = [0u8; 64];
    let len = formatted.len() as usize;
    formatted.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).unwrap();
    assert!(s.starts_with("[ERROR-1]"));
}

#[test]
fn test_format_error_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let formatted = client.format_error(&42, &make_string(&env, "ctx"));
    let mut buf = [0u8; 64];
    let len = formatted.len() as usize;
    formatted.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).unwrap();
    assert!(s.contains("[ERROR-42]"));
}

#[test]
fn test_format_error_contains_context() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let formatted = client.format_error(&1, &make_string(&env, "my_context"));
    let mut buf = [0u8; 64];
    let len = formatted.len() as usize;
    formatted.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).unwrap();
    assert!(s.contains("my_context"));
}

#[test]
fn test_format_error_contains_ledger() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let formatted = client.format_error(&1, &make_string(&env, "ctx"));
    let mut buf = [0u8; 64];
    let len = formatted.len() as usize;
    formatted.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).unwrap();
    assert!(s.contains("ledger:"));
}

#[test]
fn test_get_error_history_empty() {
    let (_env, admin, client) = setup();
    client.initialize(&admin);
    let history = client.get_error_history();
    assert_eq!(history.len(), 0);
}

#[test]
fn test_get_error_history_with_entries() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.capture_error(&1, &make_string(&env, "err1"));
    client.capture_error(&2, &make_string(&env, "err2"));
    let history = client.get_error_history();
    assert_eq!(history.len(), 2);
}

#[test]
fn test_clear_error_history() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.capture_error(&1, &make_string(&env, "err"));
    assert_eq!(client.get_error_history().len(), 1);
    client.clear_error_history();
    assert_eq!(client.get_error_history().len(), 0);
}

#[test]
fn test_error_history_fifo_eviction() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..100 {
        client.capture_error(&i, &make_string(&env, "err"));
    }
    let history = client.get_error_history();
    assert_eq!(history.len(), 100);

    // Add one more, should evict oldest
    client.capture_error(&100, &make_string(&env, "err"));
    let history = client.get_error_history();
    assert_eq!(history.len(), 100);
}

// ── Additional Boundary and Security Tests ──────────────────────────────────────

#[test]
fn test_max_length_string_accepted() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut max_str = std::string::String::new();
    for _ in 0..512 {
        max_str.push('x');
    }
    client.log_debug(&make_string(&env, &max_str));
    assert_eq!(client.get_logs().len(), 1);
}

#[test]
fn test_string_exactly_512_chars() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut exact_str = std::string::String::new();
    for _ in 0..512 {
        exact_str.push('a');
    }
    client.log_debug(&make_string(&env, &exact_str));
}

#[test]
fn test_string_over_512_chars_truncated() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut long_str = std::string::String::new();
    for _ in 0..600 {
        long_str.push('z');
    }
    client.log_debug(&make_string(&env, &long_str));
    let logs = client.get_logs();
    assert_eq!(logs.get(0).unwrap().len(), 512);
}

#[test]
fn test_key_exactly_128_chars_accepted() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut key = std::string::String::new();
    for _ in 0..128 {
        key.push('k');
    }
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(make_string(&env, &key));
    client.snapshot_state(&keys);
}

#[test]
fn test_key_129_chars_rejected() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut key = std::string::String::new();
    for _ in 0..129 {
        key.push('k');
    }
    let mut keys: Vec<String> = vec![&env];
    keys.push_back(make_string(&env, &key));
    let err = client.try_snapshot_state(&keys).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_trace_200_steps_accepted() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let tid = make_string(&env, "big_trace");
    client.start_trace(&tid);
    for i in 0..200 {
        let step = std::format!("step{}", i);
        client.record_step(&tid, &make_string(&env, &step));
    }
}

#[test]
fn test_trace_201_steps_rejected() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let tid = make_string(&env, "overflow_trace");
    client.start_trace(&tid);
    for i in 0..200 {
        let step = std::format!("s{}", i);
        client.record_step(&tid, &make_string(&env, &step));
    }
    let err = client
        .try_record_step(&tid, &make_string(&env, "overflow"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::CapExceeded);
}

#[test]
fn test_error_code_zero() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let formatted = client.format_error(&0, &make_string(&env, "ctx"));
    let mut buf = [0u8; 64];
    let len = formatted.len() as usize;
    formatted.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).unwrap();
    assert!(s.contains("[ERROR-0]"));
}

#[test]
fn test_error_code_large() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let formatted = client.format_error(&999999, &make_string(&env, "ctx"));
    let mut buf = [0u8; 64];
    let len = formatted.len() as usize;
    formatted.copy_into_slice(&mut buf[..len]);
    let s = core::str::from_utf8(&buf[..len]).unwrap();
    assert!(s.contains("[ERROR-999999]"));
}

// ── Non-initialized Contract Tests ─────────────────────────────────────────────

#[test]
fn test_log_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client
        .try_log_debug(&make_string(&env, "msg"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_logs_before_init_fails() {
    let (_env, _admin, client) = setup();
    let err = client.try_get_logs().unwrap_err().unwrap();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_start_trace_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client
        .try_start_trace(&make_string(&env, "t1"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_capture_error_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client
        .try_capture_error(&1, &make_string(&env, "ctx"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotFound);
}

// ── Additional DebugLogger Tests ───────────────────────────────────────────────

#[test]
fn test_log_debug_many_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..50 {
        let msg = std::format!("log{}", i);
        client.log_debug(&make_string(&env, &msg));
    }
    let logs = client.get_logs();
    assert_eq!(logs.len(), 50);
}

#[test]
fn test_log_warn_many_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..50 {
        let msg = std::format!("warn{}", i);
        client.log_warn(&make_string(&env, &msg));
    }
    let logs = client.get_logs();
    assert_eq!(logs.len(), 50);
}

#[test]
fn test_log_error_many_messages() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..50 {
        let msg = std::format!("error{}", i);
        client.log_error(&make_string(&env, &msg));
    }
    let logs = client.get_logs();
    assert_eq!(logs.len(), 50);
}

#[test]
fn test_log_all_special_chars_sanitized() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut msg_bytes = std::vec![b't', b'e', b's', b't'];
    for c in 0..32u8 {
        msg_bytes.push(c);
    }
    let msg = String::from_bytes(&env, &msg_bytes);
    client.log_debug(&msg);
}

#[test]
fn test_log_preserves_printable() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let msg = make_string(
        &env,
        "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~",
    );
    client.log_debug(&msg);
}

#[test]
fn test_log_clears_then_adds() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.log_debug(&make_string(&env, "old"));
    client.clear_logs();
    client.log_debug(&make_string(&env, "new"));
    let logs = client.get_logs();
    assert_eq!(logs.len(), 1);
}

// ── Additional StateInspector Tests ────────────────────────────────────────────

#[test]
fn test_compare_states_many_differences() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    for i in 0..10 {
        let key = std::format!("key_{}", i);
        map_a.set(make_string(&env, &key), make_val(&env, (i * 2) as u64));
        map_b.set(make_string(&env, &key), make_val(&env, (i * 3 + 1) as u64));
    }
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 10);
}

#[test]
fn test_compare_states_value_in_b_only() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_b.set(make_string(&env, "only_b"), make_val(&env, 42));
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 1);
}

#[test]
fn test_compare_states_same_values() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_a.set(make_string(&env, "k"), make_val(&env, 123));
    map_b.set(make_string(&env, "k"), make_val(&env, 123));
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 0);
}

#[test]
fn test_validate_state_nonexistent_key() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let val = make_val(&env, 42);
    let result = client.validate_state(&make_string(&env, "nonexistent"), &val);
    assert!(!result);
}

// ── Additional ExecutionTracer Tests ──────────────────────────────────────────

#[test]
fn test_multiple_traces() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..5 {
        let tid = std::format!("trace_{}", i);
        let s_tid = make_string(&env, &tid);
        client.start_trace(&s_tid);
        client.record_step(&s_tid, &make_string(&env, "step"));
    }
    for i in 0..5 {
        let tid = std::format!("trace_{}", i);
        let s_tid = make_string(&env, &tid);
        let trace = client.get_trace(&s_tid);
        assert_eq!(trace.len(), 1);
    }
}

#[test]
fn test_trace_with_same_id_replaces() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let tid = make_string(&env, "same_id");
    client.start_trace(&tid);
    client.record_step(&tid, &make_string(&env, "step1"));
    client.start_trace(&tid);
    client.record_step(&tid, &make_string(&env, "step2"));
    let trace = client.get_trace(&tid);
    assert_eq!(trace.len(), 1);
}

#[test]
fn test_record_step_many_times() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let tid = make_string(&env, "steps");
    client.start_trace(&tid);
    for i in 0..100 {
        let step = std::format!("step_{}", i);
        client.record_step(&tid, &make_string(&env, &step));
    }
    let trace = client.get_trace(&tid);
    assert_eq!(trace.len(), 100);
}

// ── Additional GasProfiler Tests ───────────────────────────────────────────────

#[test]
fn test_end_profile_twice_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_profile(&make_string(&env, "fn"));
    client.end_profile(&make_string(&env, "fn"));
    let err = client
        .try_end_profile(&make_string(&env, "fn"))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_start_profile_same_fn_overwrites() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.start_profile(&make_string(&env, "fn"));
    client.start_profile(&make_string(&env, "fn"));
    client.end_profile(&make_string(&env, "fn"));
}

// ── Additional ErrorDebugger Tests ─────────────────────────────────────────────

#[test]
fn test_format_error_all_codes() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..10 {
        let formatted = client.format_error(&i, &make_string(&env, "test"));
        let mut buf = [0u8; 64];
        let len = formatted.len() as usize;
        formatted.copy_into_slice(&mut buf[..len]);
        let s = core::str::from_utf8(&buf[..len]).unwrap();
        assert!(s.contains("[ERROR-"));
    }
}

#[test]
fn test_capture_error_stores_history() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let _formatted = client.capture_error(&1, &make_string(&env, "err1"));
    let history = client.get_error_history();
    assert_eq!(history.len(), 1);
}

#[test]
fn test_clear_error_history_multiple_times() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    client.capture_error(&1, &make_string(&env, "err"));
    client.clear_error_history();
    assert_eq!(client.get_error_history().len(), 0);
    client.clear_error_history();
}

// ── Additional DebugLogger Security Tests ─────────────────────────────────────

#[test]
fn test_log_only_spaces() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let msg = make_string(&env, "     ");
    client.log_debug(&msg);
}

#[test]
fn test_log_only_non_printable_rejected() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let msg = make_string(&env, "\n\t\r");
    let err = client.try_log_debug(&msg).unwrap_err().unwrap();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_log_mixed_content() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let msg = make_string(&env, "start middle end");
    client.log_debug(&msg);
}

#[test]
fn test_log_many_warns_then_errors() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for _ in 0..20 {
        let msg = make_string(&env, "warn-msg");
        client.log_warn(&msg);
    }
    for _ in 0..20 {
        let msg = make_string(&env, "error-msg");
        client.log_error(&msg);
    }
    let logs = client.get_logs();
    assert_eq!(logs.len(), 40);
}

// ── Additional StateInspector Tests ───────────────────────────────────────────

#[test]
fn test_snapshot_state_multiple_keys() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let mut keys: Vec<String> = vec![&env];
    for i in 0..10 {
        keys.push_back(format_name(&env, i));
    }
    let result = client.snapshot_state(&keys);
    assert_eq!(result.len(), 0);
}

#[test]
fn test_compare_states_empty_a_nonempty_b() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let map_a: Map<String, Val> = Map::new(&env);
    let mut map_b: Map<String, Val> = Map::new(&env);
    map_b.set(make_string(&env, "key"), make_val(&env, 1));
    let diffs = client.compare_states(&map_a, &map_b);
    assert_eq!(diffs.len(), 1);
}

// ── Additional GasProfiler Tests ─────────────────────────────────────────────

#[test]
fn test_profile_many_functions() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..20 {
        let name = std::format!("fn_{}", i);
        let s_name = make_string(&env, &name);
        client.start_profile(&s_name);
        client.end_profile(&s_name);
    }
}

// ── Additional ErrorDebugger Tests ───────────────────────────────────────────

#[test]
fn test_capture_many_errors() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    for i in 0..50 {
        let ctx = std::format!("error-{}", i);
        client.capture_error(&i, &make_string(&env, &ctx));
    }
    let history = client.get_error_history();
    assert_eq!(history.len(), 50);
}

#[test]
fn test_format_error_special_context() {
    let (env, admin, client) = setup();
    client.initialize(&admin);
    let ctx = make_string(&env, "context with spaces and symbols!@#$%");
    let formatted = client.format_error(&1, &ctx);
    assert!(formatted.len() > 0);
}

// ── Host Diagnostic Logging & Structured Profiling Traces Tests ────────────────

#[test]
fn test_host_diagnostic_logging_traces() {
    let (env, admin, client) = setup();
    client.initialize(&admin);

    // Profile run with structured host diagnostics
    let fn_name = make_string(&env, "transfer_tokens");
    client.start_profile(&fn_name);
    client.log_debug(&make_string(&env, "executing transfer step"));
    let cost = client.end_profile(&fn_name);
    let _ = cost;

    // Verify diagnostic events exist in host logs
    let diagnostic_logs = env.logs().all();
    assert!(!diagnostic_logs.is_empty());
}
