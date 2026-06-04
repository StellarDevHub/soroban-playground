//! # Property-Based Testing Utilities Contract
//!
//! Comprehensive set of property-based testing utilities for Soroban smart contracts:
//! - PropertyTester: Secure wrapper for property-based contract testing
//! - InvariantChecker: Utility for checking contract invariants during testing
//! - BoundaryTester: Utility for testing contract boundary conditions
//! - FuzzGenerator: Utility for generating fuzz test inputs
//! - PropertyValidator: Utility for validating contract properties and behaviors

#![no_std]

mod test;

use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Env, String, Val, Vec, Map, Symbol,
};

const ADMIN: Symbol = symbol_short!("ADMIN");
const PROPERTY_RESULTS: Symbol = symbol_short!("PRESULTS");
const INVARIANT_RESULTS: Symbol = symbol_short!("IRESULTS");
const MAX_PROPERTY_RUNS: u32 = 1000;
const MAX_INVARIANT_CHECKS: u32 = 500;
const MAX_GENERATED_VALUES: u32 = 1000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    InvalidInput = 2,
    NotFound = 3,
    CapExceeded = 4,
    PropertyFailed = 5,
    InvariantViolated = 6,
}

fn get_admin(env: &Env) -> Result<Address, Error> {
    env.instance().get(&ADMIN).ok_or(Error::Unauthorized)
}

fn set_admin(env: &Env, admin: &Address) {
    env.instance().set(&ADMIN, admin);
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !env.instance().has::<Address>(&ADMIN) {
        return Err(Error::NotFound);
    }
    Ok(())
}

fn u32_to_string(env: &Env, n: u32) -> String {
    if n == 0 {
        return String::from_str(env, "0");
    }
    let mut bytes: Vec<u8> = Vec::new(env);
    let mut m = n;
    while m > 0 {
        bytes.insert(0, b'0' + (m % 10) as u8);
        m /= 10;
    }
    String::from_bytes(env, &bytes)
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PropertyStatus {
    Passed = 0,
    Failed = 1,
    Skipped = 2,
}

#[contract]
pub struct PropertyTestingUtils;

#[contractimpl]
impl PropertyTestingUtils {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.instance().has::<Address>(&ADMIN) {
            return Err(Error::CapExceeded);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.instance().set(&PROPERTY_RESULTS, &Vec::<String>::new(&env));
        env.instance().set(&INVARIANT_RESULTS, &Vec::<String>::new(&env));
        Ok(())
    }

    // ── PropertyTester ────────────────────────────────────────────────────────────

    pub fn run_property(env: Env, property_name: String, runs: u32, should_pass: bool) -> Result<PropertyStatus, Error> {
        ensure_initialized(&env)?;
        if property_name.is_empty() || runs == 0 || runs > MAX_PROPERTY_RUNS {
            return Err(Error::InvalidInput);
        }
        
        let status = if should_pass {
            PropertyStatus::Passed
        } else {
            PropertyStatus::Failed
        };
        
        let mut results: Vec<String> = env.instance().get(&PROPERTY_RESULTS).unwrap_or_else(|| Vec::<String>::new(&env));
        let result_str = String::from_str(
            &env,
            &format!("{}: {:?} ({} runs)", property_name, status, runs),
        );
        results.push_back(result_str);
        env.instance().set(&PROPERTY_RESULTS, &results);
        
        env.events().publish(
            (symbol_short!("PropertyTested"), property_name.clone()),
            (status as u32, runs),
        );
        
        if status == PropertyStatus::Failed {
            return Err(Error::PropertyFailed);
        }
        
        Ok(status)
    }

    pub fn get_property_results(env: Env) -> Result<Vec<String>, Error> {
        ensure_initialized(&env)?;
        Ok(env.instance().get(&PROPERTY_RESULTS).unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    pub fn clear_property_results(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        env.instance().set(&PROPERTY_RESULTS, &Vec::<String>::new(&env));
        Ok(())
    }

    // ── InvariantChecker ─────────────────────────────────────────────────────────

    pub fn check_invariant(env: Env, invariant_name: String, holds: bool) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        if invariant_name.is_empty() {
            return Err(Error::InvalidInput);
        }
        
        let mut results: Vec<String> = env.instance().get(&INVARIANT_RESULTS).unwrap_or_else(|| Vec::<String>::new(&env));
        let result_str = if holds {
            String::from_str(&env, &format!("{}: holds", invariant_name))
        } else {
            String::from_str(&env, &format!("{}: violated", invariant_name))
        };
        results.push_back(result_str);
        if results.len() > MAX_INVARIANT_CHECKS as usize {
            results.remove(0);
        }
        env.instance().set(&INVARIANT_RESULTS, &results);
        
        env.events().publish(
            (symbol_short!("InvariantChecked"), invariant_name),
            holds,
        );
        
        if !holds {
            return Err(Error::InvariantViolated);
        }
        
        Ok(true)
    }

    pub fn get_invariant_results(env: Env) -> Result<Vec<String>, Error> {
        ensure_initialized(&env)?;
        Ok(env.instance().get(&INVARIANT_RESULTS).unwrap_or_else(|| Vec::<String>::new(&env)))
    }

    pub fn clear_invariant_results(env: Env) -> Result<(), Error> {
        ensure_initialized(&env)?;
        env.instance().set(&INVARIANT_RESULTS, &Vec::<String>::new(&env));
        Ok(())
    }

    // ── BoundaryTester ────────────────────────────────────────────────────────────

    pub fn test_u32_boundaries(env: Env, value: u32) -> Result<Vec<u32>, Error> {
        let mut boundaries: Vec<u32> = Vec::new(&env);
        boundaries.push_back(0);
        boundaries.push_back(1);
        boundaries.push_back(u32::MAX - 1);
        boundaries.push_back(u32::MAX);
        boundaries.push_back(value);
        Ok(boundaries)
    }

    pub fn test_i32_boundaries(env: Env, value: i32) -> Result<Vec<i32>, Error> {
        let mut boundaries: Vec<i32> = Vec::new(&env);
        boundaries.push_back(i32::MIN);
        boundaries.push_back(i32::MIN + 1);
        boundaries.push_back(-1);
        boundaries.push_back(0);
        boundaries.push_back(1);
        boundaries.push_back(i32::MAX - 1);
        boundaries.push_back(i32::MAX);
        boundaries.push_back(value);
        Ok(boundaries)
    }

    pub fn test_string_lengths(env: Env, base: String, max_len: u32) -> Result<Vec<String>, Error> {
        if max_len > 1024 {
            return Err(Error::InvalidInput);
        }
        let mut lengths: Vec<String> = Vec::new(&env);
        lengths.push_back(String::from_str(&env, ""));
        lengths.push_back(String::from_str(&env, "a"));
        if !base.is_empty() {
            lengths.push_back(base.clone());
        }
        Ok(lengths)
    }

    // ── FuzzGenerator ─────────────────────────────────────────────────────────────

    pub fn generate_u32s(env: Env, count: u32, seed: u32) -> Result<Vec<u32>, Error> {
        if count == 0 || count > MAX_GENERATED_VALUES {
            return Err(Error::InvalidInput);
        }
        let mut values: Vec<u32> = Vec::new(&env);
        let mut current = seed;
        for _ in 0..count {
            current = current.wrapping_mul(1103515245).wrapping_add(12345);
            values.push_back(current);
        }
        Ok(values)
    }

    pub fn generate_i32s(env: Env, count: u32, seed: u32) -> Result<Vec<i32>, Error> {
        if count == 0 || count > MAX_GENERATED_VALUES {
            return Err(Error::InvalidInput);
        }
        let mut values: Vec<i32> = Vec::new(&env);
        let mut current = seed;
        for _ in 0..count {
            current = current.wrapping_mul(1103515245).wrapping_add(12345);
            values.push_back(current as i32);
        }
        Ok(values)
    }

    pub fn generate_strings(env: Env, count: u32, seed: u32, max_len: u32) -> Result<Vec<String>, Error> {
        if count == 0 || count > MAX_GENERATED_VALUES || max_len > 1024 {
            return Err(Error::InvalidInput);
        }
        let mut strings: Vec<String> = Vec::new(&env);
        let mut current = seed;
        for _ in 0..count {
            let mut bytes: Vec<u8> = Vec::new(&env);
            let len = (current % max_len) as usize;
            for _ in 0..len {
                current = current.wrapping_mul(1103515245).wrapping_add(12345);
                let c = (current % 26) as u8 + b'a';
                bytes.push_back(c);
            }
            strings.push_back(String::from_bytes(&env, &bytes));
        }
        Ok(strings)
    }

    // ── PropertyValidator ─────────────────────────────────────────────────────────

    pub fn validate_equality(env: Env, a: Val, b: Val, property_name: String) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        let equal = a == b;
        env.events().publish(
            (symbol_short!("EqualityValidated"), property_name),
            equal,
        );
        Ok(equal)
    }

    pub fn validate_range(env: Env, value: u32, min: u32, max: u32, property_name: String) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        let in_range = value >= min && value <= max;
        env.events().publish(
            (symbol_short!("RangeValidated"), property_name),
            in_range,
        );
        Ok(in_range)
    }

    pub fn validate_non_zero(env: Env, value: u32, property_name: String) -> Result<bool, Error> {
        ensure_initialized(&env)?;
        let non_zero = value != 0;
        env.events().publish(
            (symbol_short!("NonZeroValidated"), property_name),
            non_zero,
        );
        Ok(non_zero)
    }
}
