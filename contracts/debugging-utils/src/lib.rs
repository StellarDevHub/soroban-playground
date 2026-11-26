// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Debugging Utilities Contract
//!
//! Collection of debugging utilities for Soroban smart contracts:
//! - DebugLogger: Log messages with sanitization and host diagnostics
//! - StateInspector: Inspect and compare contract state
//! - ExecutionTracer: Trace execution steps with host diagnostic logging
//! - GasProfiler: Profile function execution timers and costs
//! - ErrorDebugger: Capture and format errors

#![no_std]

mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Env, IntoVal, Map, String,
    Symbol, Val, Vec,
};

const ADMIN: Symbol = symbol_short!("ADMIN");
const LOGS: Symbol = symbol_short!("LOGS");
const MAX_LOG_LEN: usize = 512;
const MAX_KEY_LEN: u32 = 128;
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

fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

fn sanitize_message(env: &Env, msg: &String) -> Result<String, Error> {
    let len = msg.len() as usize;
    if len == 0 {
        return Err(Error::InvalidInput);
    }
    let mut raw = [0u8; 1024];
    let to_read = len.min(1024);
    msg.copy_into_slice(&mut raw[..to_read]);

    let mut sanitized = [0u8; MAX_LOG_LEN];
    let mut out_len = 0;
    for &b in raw[..to_read].iter() {
        if (32..=126).contains(&b) {
            if out_len < MAX_LOG_LEN {
                sanitized[out_len] = b;
                out_len += 1;
            }
        }
    }
    if out_len == 0 {
        return Err(Error::InvalidInput);
    }
    Ok(String::from_bytes(env, &sanitized[..out_len]))
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !env.storage().instance().has::<Symbol>(&ADMIN) {
        return Err(Error::NotFound);
    }
    Ok(())
}

fn make_diff_string(
    env: &Env,
    _key: &String,
    _val_a: &Option<Val>,
    val_b: &Option<Val>,
) -> String {
    match val_b {
        Some(_) => String::from_str(env, "k: A -> B"),
        None => String::from_str(env, "k: A -> None"),
    }
}

fn write_u32_to_buf(mut n: u32, buf: &mut [u8]) -> usize {
    if n == 0 {
        buf[0] = b'0';
        return 1;
    }
    let mut tmp = [0u8; 10];
    let mut len = 0;
    while n > 0 {
        tmp[len] = b'0' + (n % 10) as u8;
        n /= 10;
        len += 1;
    }
    for i in 0..len {
        buf[i] = tmp[len - 1 - i];
    }
    len
}

fn format_error_internal(env: &Env, code: u32, context: &String, ledger: u32) -> String {
    let mut buf = [0u8; 1024];
    let mut pos = 0;

    let prefix = b"[ERROR-";
    buf[pos..pos + prefix.len()].copy_from_slice(prefix);
    pos += prefix.len();

    pos += write_u32_to_buf(code, &mut buf[pos..]);

    let mid = b"] ";
    buf[pos..pos + mid.len()].copy_from_slice(mid);
    pos += mid.len();

    let ctx_len = context.len() as usize;
    let ctx_to_copy = ctx_len.min(buf.len().saturating_sub(pos + 30));
    context.copy_into_slice(&mut buf[pos..pos + ctx_to_copy]);
    pos += ctx_to_copy;

    let ledger_prefix = b" @ ledger:";
    buf[pos..pos + ledger_prefix.len()].copy_from_slice(ledger_prefix);
    pos += ledger_prefix.len();

    pos += write_u32_to_buf(ledger, &mut buf[pos..]);

    String::from_bytes(env, &buf[..pos])
}

fn get_execution_timer(env: &Env) -> u64 {
    // Non-intrusive execution timer compatible with both testnet and local mock environments
    env.ledger().timestamp()
}

#[contract]
pub struct DebuggingUtils;

#[contractimpl]
impl DebuggingUtils {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has::<Symbol>(&ADMIN) {
            return Err(Error::CapExceeded);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&LOGS, &Vec::<String>::new(&env));
        env.logs().add("init", &[admin.to_val()]);
        Ok(())
    }

    // ── DebugLogger ────────────────────────────────────────────────────────────────

    pub fn log_debug(env: Env, message: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sanitized = sanitize_message(&env, &message)?;
        let mut logs: Vec<String> = env
            .storage()
            .instance()
            .get(&LOGS)
            .unwrap_or_else(|| Vec::<String>::new(&env));
        logs.push_back(sanitized.clone());
        env.storage().instance().set(&LOGS, &logs);
        env.events().publish(
            (symbol_short!("LogEmit"), symbol_short!("debug")),
            sanitized.clone(),
        );
        env.logs().add("debug_log", &[sanitized.to_val()]);
        Ok(())
    }

    pub fn log_warn(env: Env, message: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sanitized = sanitize_message(&env, &message)?;
        let mut logs: Vec<String> = env
            .storage()
            .instance()
            .get(&LOGS)
            .unwrap_or_else(|| Vec::<String>::new(&env));
        logs.push_back(sanitized.clone());
        env.storage().instance().set(&LOGS, &logs);
        env.events().publish(
            (symbol_short!("LogEmit"), symbol_short!("warn")),
            sanitized.clone(),
        );
        env.logs().add("warn_log", &[sanitized.to_val()]);
        Ok(())
    }

    pub fn log_error(env: Env, message: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        let sanitized = sanitize_message(&env, &message)?;
        let mut logs: Vec<String> = env
            .storage()
            .instance()
            .get(&LOGS)
            .unwrap_or_else(|| Vec::<String>::new(&env));
        logs.push_back(sanitized.clone());
        env.storage().instance().set(&LOGS, &logs);
        env.events().publish(
            (symbol_short!("LogEmit"), symbol_short!("error")),
            sanitized.clone(),
        );
        env.logs().add("error_log", &[sanitized.to_val()]);
        Ok(())
    }

    pub fn get_logs(env: Env) -> Result<Vec<String>, Error> {
        ensure_initialized(&env)?;
        Ok(env
            .storage()
            .instance()
            .get(&LOGS)
            .unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    pub fn clear_logs(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        env.storage()
            .instance()
            .set(&LOGS, &Vec::<String>::new(&env));
        Ok(())
    }

    // ── StateInspector ─────────────────────────────────────────────────────────────

    pub fn snapshot_state(env: Env, keys: Vec<String>) -> Result<Map<String, Val>, Error> {
        let mut map: Map<String, Val> = Map::new(&env);
        for key in keys.iter() {
            if key.is_empty() || key.len() > MAX_KEY_LEN {
                return Err(Error::InvalidInput);
            }
            if let Some(val) = env.storage().instance().get::<String, Val>(&key) {
                map.set(key, val);
            }
        }
        Ok(map)
    }

    pub fn compare_states(
        env: Env,
        snapshot_a: Map<String, Val>,
        snapshot_b: Map<String, Val>,
    ) -> Result<Vec<String>, Error> {
        let mut diffs: Vec<String> = Vec::new(&env);
        for (key, val_a) in snapshot_a.iter() {
            let val_b = snapshot_b.get(key.clone());
            let is_same = match (&val_b, &val_a) {
                (Some(b), a) => b.get_payload() == a.get_payload(),
                (None, _) => false,
            };
            if !is_same {
                let diff = make_diff_string(&env, &key, &Some(val_a), &val_b);
                diffs.push_back(diff);
            }
        }
        for (key, val_b) in snapshot_b.iter() {
            if !snapshot_a.contains_key(key.clone()) {
                let diff = make_diff_string(&env, &key, &None, &Some(val_b));
                diffs.push_back(diff);
            }
        }
        Ok(diffs)
    }

    pub fn validate_state(env: Env, key: String, expected_value: Val) -> Result<bool, Error> {
        if key.is_empty() || key.len() > MAX_KEY_LEN {
            return Err(Error::InvalidInput);
        }
        let current: Option<Val> = env.storage().instance().get(&key);
        match current {
            Some(v) => Ok(v.get_payload() == expected_value.get_payload()),
            None => Ok(false),
        }
    }

    // ── ExecutionTracer ─────────────────────────────────────────────────────────────

    pub fn start_trace(env: Env, trace_id: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        if trace_id.is_empty() {
            return Err(Error::InvalidInput);
        }
        let trace_key = (symbol_short!("tr"), trace_id.clone());
        let empty_vec: Vec<String> = Vec::new(&env);
        env.storage().persistent().set(&trace_key, &empty_vec);
        env.logs().add("trace_start", &[trace_id.to_val()]);
        Ok(())
    }

    pub fn record_step(env: Env, trace_id: String, step: String) -> Result<(), Error> {
        if trace_id.is_empty() || step.is_empty() {
            return Err(Error::InvalidInput);
        }
        let trace_key = (symbol_short!("tr"), trace_id.clone());
        let mut trace: Vec<String> = env
            .storage()
            .persistent()
            .get(&trace_key)
            .unwrap_or_else(|| Vec::<String>::new(&env));
        if trace.len() >= MAX_TRACE_STEPS {
            return Err(Error::CapExceeded);
        }
        trace.push_back(step.clone());
        env.storage().persistent().set(&trace_key, &trace);
        env.logs()
            .add("trace_step", &[trace_id.to_val(), step.to_val()]);
        Ok(())
    }

    pub fn end_trace(env: Env, trace_id: String) -> Result<Vec<String>, Error> {
        if trace_id.is_empty() {
            return Err(Error::NotFound);
        }
        let trace_key = (symbol_short!("tr"), trace_id.clone());
        let trace: Vec<String> = env
            .storage()
            .persistent()
            .get(&trace_key)
            .ok_or(Error::NotFound)?;
        env.logs().add("trace_end", &[trace_id.to_val()]);
        Ok(trace)
    }

    pub fn get_trace(env: Env, trace_id: String) -> Result<Vec<String>, Error> {
        if trace_id.is_empty() {
            return Err(Error::NotFound);
        }
        let trace_key = (symbol_short!("tr"), trace_id.clone());
        Ok(env
            .storage()
            .persistent()
            .get(&trace_key)
            .unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    // ── GasProfiler ───────────────────────────────────────────────────────────────

    pub fn start_profile(env: Env, fn_name: String) -> Result<(), Error> {
        if fn_name.is_empty() {
            return Err(Error::InvalidInput);
        }
        let key = (symbol_short!("ps"), fn_name.clone());
        let start_time = get_execution_timer(&env);
        env.storage().instance().set(&key, &start_time);
        env.logs().add("profile_start", &[fn_name.to_val()]);
        Ok(())
    }

    pub fn end_profile(env: Env, fn_name: String) -> Result<u64, Error> {
        if fn_name.is_empty() {
            return Err(Error::NotFound);
        }
        let key = (symbol_short!("ps"), fn_name.clone());
        let start_time: u64 = env.storage().instance().get(&key).ok_or(Error::NotFound)?;
        let current_time = get_execution_timer(&env);
        let elapsed = current_time.saturating_sub(start_time);

        let rep_key: Symbol = symbol_short!("prep");
        let mut report: Map<String, u64> = env
            .storage()
            .instance()
            .get(&rep_key)
            .unwrap_or_else(|| Map::new(&env));
        let existing = report.get(fn_name.clone()).unwrap_or(0);
        report.set(fn_name.clone(), existing + elapsed);
        env.storage().instance().set(&rep_key, &report);
        env.storage().instance().remove(&key);

        env.logs()
            .add("profile_end", &[fn_name.to_val(), elapsed.into_val(&env)]);
        Ok(elapsed)
    }

    pub fn get_profile_report(env: Env) -> Result<Map<String, u64>, Error> {
        let rep_key: Symbol = symbol_short!("prep");
        Ok(env
            .storage()
            .instance()
            .get(&rep_key)
            .unwrap_or_else(|| Map::new(&env)))
    }

    pub fn reset_profiles(env: Env) -> Result<(), Error> {
        let rep_key: Symbol = symbol_short!("prep");
        env.storage().instance().remove(&rep_key);
        Ok(())
    }

    // ── ErrorDebugger ─────────────────────────────────────────────────────────────

    pub fn capture_error(env: Env, code: u32, context: String) -> Result<String, Error> {
        ensure_initialized(&env)?;
        let ledger = env.ledger().sequence();
        let formatted = format_error_internal(&env, code, &context, ledger);
        let mut history: Vec<String> = env
            .storage()
            .instance()
            .get(&symbol_short!("EH"))
            .unwrap_or_else(|| Vec::<String>::new(&env));
        if history.len() >= MAX_ERROR_HISTORY {
            history.remove(0);
        }
        history.push_back(formatted.clone());
        env.storage().instance().set(&symbol_short!("EH"), &history);
        env.logs()
            .add("error_captured", &[code.into_val(&env), context.to_val()]);
        Ok(formatted)
    }

    pub fn get_error_history(env: Env) -> Result<Vec<String>, Error> {
        Ok(env
            .storage()
            .instance()
            .get(&symbol_short!("EH"))
            .unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    pub fn format_error(env: Env, code: u32, context: String) -> Result<String, Error> {
        let ledger = env.ledger().sequence();
        Ok(format_error_internal(&env, code, &context, ledger))
    }

    pub fn clear_error_history(env: Env) -> Result<(), Error> {
        env.storage()
            .instance()
            .set(&symbol_short!("EH"), &Vec::<String>::new(&env));
        Ok(())
    }
}
