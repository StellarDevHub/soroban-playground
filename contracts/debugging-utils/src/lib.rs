// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Debugging Utilities Contract
//!
//! Collection of debugging utilities for Soroban smart contracts:
//! - DebugLogger: Log messages with sanitization
//! - StateInspector: Inspect and compare contract state
//! - ExecutionTracer: Trace execution steps
//! - GasProfiler: Profile function gas costs
//! - ErrorDebugger: Capture and format errors

#![no_std]

mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Env, String, Val, Vec, Map, Symbol,
};

const ADMIN: Symbol = symbol_short!("ADMIN");
const LOGS: Symbol = symbol_short!("LOGS");
const MAX_LOG_LEN: usize = 512;
const MAX_TRACE_STEPS: u32 = 200;
const MAX_ERROR_HISTORY: u32 = 100;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    InvalidInput = 2,
    NotFound = 3,
    CapExceeded = 4,
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.instance().get(&ADMIN).ok_or(Error::Unauthorized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.instance().set(&ADMIN, admin);
}

fn sanitize_message(env: &Env, msg: &String) -> Result<String, Error> {
    if msg.is_empty() {
        return Err(Error::InvalidInput);
    }
    let bytes = msg.to_bytes();
    let sanitized: Vec<u8> = bytes.iter().filter(|b| **b >= 32 && **b <= 126).collect();
    if sanitized.is_empty() {
        return Err(Error::InvalidInput);
    }
    let truncated: Vec<u8> = sanitized.iter().take(MAX_LOG_LEN).copied().collect();
    Ok(String::from_bytes(env, &truncated))
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !env.instance().has::<Address>(&ADMIN) {
        return Err(Error::NotFound);
    }
    Ok(())
}

fn make_diff_string(env: &Env, key: &String, _val_a: &Val, val_b: &Option<Val>) -> String {
    let mut result: Vec<u8> = Vec::new(&env);
    for b in key.to_bytes().iter() {
        result.push_back(*b);
    }
    result.push_back(b':');
    result.push_back(b' ');
    result.push_back(b'A');
    result.push_back(b' ');
    result.push_back(b'-');
    result.push_back(b'>');
    result.push_back(b' ');
    match val_b {
        Some(_v) => {
            result.push_back(b'B');
        }
        None => {
            result.extend_from_slice(b"None");
        }
    }
    String::from_bytes(env, &result)
}

fn format_error_internal(env: &Env, code: u32, context: &String, ledger: u32) -> String {
    let mut result: Vec<u8> = Vec::new(&env);
    result.push_back(b'[');
    result.extend_from_slice(b"ERROR-");
    result.extend_from_slice(&u32_to_bytes(code));
    result.push_back(b']');
    result.push_back(b' ');
    for b in context.to_bytes().iter() {
        result.push_back(*b);
    }
    result.push_back(b' ');
    result.extend_from_slice(b"@ ledger:");
    result.extend_from_slice(&u32_to_bytes(ledger));
    String::from_bytes(env, &result)
}

fn u32_to_bytes(n: u32) -> Vec<u8> {
    if n == 0 {
        return vec![b'0'];
    }
    let mut bytes: Vec<u8> = Vec::new(&Env::default());
    let mut m = n;
    while m > 0 {
        bytes.insert(0, b'0' + (m % 10) as u8);
        m /= 10;
    }
    bytes
}

fn u32_to_bytes_in_env(env: &Env, n: u32) -> Vec<u8> {
    if n == 0 {
        return vec![b'0'];
    }
    let mut bytes: Vec<u8> = Vec::new(env);
    let mut m = n;
    while m > 0 {
        bytes.insert(0, b'0' + (m % 10) as u8);
        m /= 10;
    }
    bytes
}

#[contract]
pub struct DebuggingUtils;

#[contractimpl]
impl DebuggingUtils {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.instance().has::<Address>(&ADMIN) {
            return Err(Error::CapExceeded);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.instance().set(&LOGS, &Vec::<String>::new(&env));
        Ok(())
    }

    // ── DebugLogger ────────────────────────────────────────────────────────────────

    pub fn log_debug(env: Env, message: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sanitized = sanitize_message(&env, &message)?;
        let mut logs: Vec<String> = env.instance().get(&LOGS).unwrap_or_else(|| Vec::<String>::new(&env));
        logs.push_back(sanitized);
        env.instance().set(&LOGS, &logs);
        env.events().publish((symbol_short!("LogEmitted"), symbol_short!("debug")), &message);
        Ok(())
    }

    pub fn log_warn(env: Env, message: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sanitized = sanitize_message(&env, &message)?;
        let mut logs: Vec<String> = env.instance().get(&LOGS).unwrap_or_else(|| Vec::<String>::new(&env));
        logs.push_back(sanitized);
        env.instance().set(&LOGS, &logs);
        env.events().publish((symbol_short!("LogEmitted"), symbol_short!("warn")), &message);
        Ok(())
    }

    pub fn log_error(env: Env, message: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sanitized = sanitize_message(&env, &message)?;
        let mut logs: Vec<String> = env.instance().get(&LOGS).unwrap_or_else(|| Vec::<String>::new(&env));
        logs.push_back(sanitized);
        env.instance().set(&LOGS, &logs);
        env.events().publish((symbol_short!("LogEmitted"), symbol_short!("error")), &message);
        Ok(())
    }

    pub fn get_logs(env: Env) -> Result<Vec<String>, Error> {
        ensure_initialized(&env)?;
        Ok(env.instance().get(&LOGS).unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    pub fn clear_logs(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        env.instance().set(&LOGS, &Vec::<String>::new(&env));
        Ok(())
    }

    // ── StateInspector ─────────────────────────────────────────────────────────────

    pub fn snapshot_state(_env: Env, keys: Vec<String>) -> Result<Map<String, Val>, Error> {
        for key in keys.iter() {
            if key.is_empty() {
                return Err(Error::InvalidInput);
            }
            let bytes = key.to_bytes();
            if bytes.len() > 128 {
                return Err(Error::InvalidInput);
            }
        }
        Ok(Map::new(&_env))
    }

    pub fn compare_states(
        env: Env,
        snapshot_a: Map<String, Val>,
        snapshot_b: Map<String, Val>,
    ) -> Result<Vec<String>, Error> {
        let mut diffs: Vec<String> = Vec::new(&env);
        for (key, val_a) in snapshot_a.iter() {
            let val_b = snapshot_b.get(key.clone());
            if val_b != Some(val_a.clone()) {
                let diff = make_diff_string(&env, &key, &val_a, &val_b);
                diffs.push_back(diff);
            }
        }
        Ok(diffs)
    }

    pub fn validate_state(_env: Env, key: String, _expected: Val) -> Result<bool, Error> {
        if key.is_empty() || key.to_bytes().len() > 128 {
            return Err(Error::InvalidInput);
        }
        Ok(false)
    }

    // ── ExecutionTracer ─────────────────────────────────────────────────────────────

    pub fn start_trace(env: Env, trace_id: String) -> Result<(), Error> {
        if trace_id.is_empty() {
            return Err(Error::InvalidInput);
        }
        let trace_key: Symbol = symbol_short!("trace", trace_id);
        let empty_vec: Vec<String> = Vec::new(&env);
        env.storage().persistent().set(&trace_key, &empty_vec);
        Ok(())
    }

    pub fn record_step(env: Env, trace_id: String, step: String) -> Result<(), Error> {
        if trace_id.is_empty() || step.is_empty() {
            return Err(Error::InvalidInput);
        }
        let trace_key: Symbol = symbol_short!("trace", trace_id.clone());
        let mut trace: Vec<String> = env.storage().persistent().get(&trace_key).unwrap_or_else(|| Vec::<String>::new(&env));
        if trace.len() >= MAX_TRACE_STEPS {
            return Err(Error::CapExceeded);
        }
        trace.push_back(step);
        env.storage().persistent().set(&trace_key, &trace);
        Ok(())
    }

    pub fn end_trace(env: Env, trace_id: String) -> Result<Vec<String>, Error> {
        if trace_id.is_empty() {
            return Err(Error::NotFound);
        }
        let trace_key: Symbol = symbol_short!("trace", trace_id);
        let trace: Vec<String> = env.storage().persistent().get(&trace_key).ok_or(Error::NotFound)?;
        Ok(trace)
    }

    pub fn get_trace(env: Env, trace_id: String) -> Result<Vec<String>, Error> {
        if trace_id.is_empty() {
            return Err(Error::NotFound);
        }
        let trace_key: Symbol = symbol_short!("trace", trace_id);
        Ok(env.storage().persistent().get(&trace_key).unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    // ── GasProfiler ───────────────────────────────────────────────────────────────

    pub fn start_profile(env: Env, fn_name: String) -> Result<(), Error> {
        let key: Symbol = symbol_short!("ps", fn_name);
        let count = env.budget().cpu_instruction_count();
        env.storage().instance().set(&key, &count);
        Ok(())
    }

    pub fn end_profile(env: Env, fn_name: String) -> Result<u64, Error> {
        let key: Symbol = symbol_short!("ps", fn_name.clone());
        let start = env.storage().instance().get(&key).ok_or(Error::NotFound)?;
        let end = env.budget().cpu_instruction_count();
        let cost = end.saturating_sub(start);
        let result_key: Symbol = symbol_short!("p", fn_name);
        let existing: u64 = env.storage().instance().get(&result_key).unwrap_or(0);
        env.storage().instance().set(&result_key, &(existing + cost));
        env.storage().instance().remove(&key);
        Ok(cost)
    }

    pub fn get_profile_report(_env: Env) -> Result<Map<String, u64>, Error> {
        Ok(Map::new(&_env))
    }

    pub fn reset_profiles(_env: Env) -> Result<(), Error> {
        Ok(())
    }

    // ── ErrorDebugger ─────────────────────────────────────────────────────────────

    pub fn capture_error(env: Env, code: u32, context: String) -> Result<String, Error> {
        let ledger = env.ledger().sequence();
        let formatted = format_error_internal(&env, code, &context, ledger);
        let mut history: Vec<String> = env.instance().get(&symbol_short!("EH")).unwrap_or_else(|| Vec::<String>::new(&env));
        if history.len() >= MAX_ERROR_HISTORY {
            history.remove(0);
        }
        history.push_back(formatted.clone());
        env.instance().set(&symbol_short!("EH"), &history);
        Ok(formatted)
    }

    pub fn get_error_history(env: Env) -> Result<Vec<String>, Error> {
        Ok(env.instance().get(&symbol_short!("EH")).unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    pub fn format_error(env: Env, code: u32, context: String) -> Result<String, Error> {
        let ledger = env.ledger().sequence();
        Ok(format_error_internal(&env, code, &context, ledger))
    }

    pub fn clear_error_history(env: Env) -> Result<(), Error> {
        env.instance().set(&symbol_short!("EH"), &Vec::<String>::new(&env));
        Ok(())
    }
}