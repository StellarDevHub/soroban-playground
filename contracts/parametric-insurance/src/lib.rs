// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Parametric Insurance Payout Contract
//!
//! Automates insurance payouts based on oracle-reported real-world data:
//! - Admin defines Products (coverage type, trigger condition, oracle).
//! - Policyholders purchase Policies for a fixed term.
//! - Authorised oracles push readings (e.g. rainfall mm, temperature °C).
//! - Anyone can call `process_claim` for a qualifying policy — if the latest
//!   oracle reading breaches the product's trigger threshold the policy is
//!   paid out automatically; no manual adjudication required.
//! - Expired policies without a triggered payout simply move to `Expired`.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_oracle_reading, get_policy, get_policy_count, get_product, get_product_count,
    is_initialized, is_oracle, set_admin, set_oracle, set_oracle_reading, set_policy,
    set_policy_count, set_product, set_product_count,
};
use crate::types::{
    Error, OracleReading, Policy, PolicyStatus, Product, TriggerDirection,
};

/// Maximum staleness window for oracle data (24 hours).
const MAX_ORACLE_STALENESS_SECS: u64 = 86_400;

#[contract]
pub struct ParametricInsurance;

#[contractimpl]
impl ParametricInsurance {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_product_count(&env, 0);
        set_policy_count(&env, 0);
        Ok(())
    }

    // ── Oracle management ─────────────────────────────────────────────────────

    /// Register or deregister an authorised oracle address.
    pub fn set_oracle(env: Env, admin: Address, oracle: Address, active: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_oracle(&env, &oracle, active);
        env.events()
            .publish((symbol_short!("oracle"),), (oracle, active));
        Ok(())
    }

    /// Oracle submits a reading for a specific parameter.
    pub fn submit_reading(
        env: Env,
        oracle: Address,
        parameter_key: String,
        value: i128,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        oracle.require_auth();
        if !is_oracle(&env, &oracle) {
            return Err(Error::UnknownOracle);
        }
        let reading = OracleReading {
            parameter_key: parameter_key.clone(),
            value,
            timestamp: env.ledger().timestamp(),
        };
        set_oracle_reading(&env, &oracle, &parameter_key, &reading);
        env.events()
            .publish((symbol_short!("reading"),), (oracle, parameter_key, value));
        Ok(())
    }

    pub fn get_reading(env: Env, oracle: Address, parameter_key: String) -> Option<OracleReading> {
        get_oracle_reading(&env, &oracle, &parameter_key)
    }

    // ── Product management (admin) ────────────────────────────────────────────

    /// Create a new insurance product. Returns the product ID.
    pub fn create_product(
        env: Env,
        admin: Address,
        name: String,
        premium: i128,
        coverage_amount: i128,
        oracle: Address,
        parameter_key: String,
        trigger_threshold: i128,
        trigger_direction: TriggerDirection,
        term_secs: u64,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if premium <= 0 {
            return Err(Error::ZeroPremium);
        }
        if coverage_amount <= 0 {
            return Err(Error::ZeroCoverage);
        }
        if term_secs == 0 {
            return Err(Error::InvalidTrigger);
        }

        let id = get_product_count(&env) + 1;
        let product = Product {
            name,
            premium,
            coverage_amount,
            oracle,
            parameter_key,
            trigger_threshold,
            trigger_direction,
            term_secs,
            is_active: true,
        };
        set_product(&env, id, &product);
        set_product_count(&env, id);
        env.events().publish((symbol_short!("prod_new"),), id);
        Ok(id)
    }

    pub fn deactivate_product(env: Env, admin: Address, product_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut product = get_product(&env, product_id)?;
        product.is_active = false;
        set_product(&env, product_id, &product);
        Ok(())
    }

    pub fn get_product(env: Env, product_id: u32) -> Result<Product, Error> {
        get_product(&env, product_id)
    }

    pub fn product_count(env: Env) -> u32 {
        get_product_count(&env)
    }

    // ── Policy purchase ───────────────────────────────────────────────────────

    /// Purchase a policy for `product_id`. Returns the policy ID.
    pub fn buy_policy(env: Env, holder: Address, product_id: u32) -> Result<u32, Error> {
        Self::assert_initialized(&env)?;
        holder.require_auth();
        let product = get_product(&env, product_id)?;
        if !product.is_active {
            return Err(Error::ProductInactive);
        }

        let now = env.ledger().timestamp();
        let id = get_policy_count(&env) + 1;
        let policy = Policy {
            product_id,
            holder: holder.clone(),
            premium_paid: product.premium,
            coverage_amount: product.coverage_amount,
            purchased_at: now,
            expires_at: now + product.term_secs,
            status: PolicyStatus::Active,
            trigger_value: None,
            payout_amount: None,
        };
        set_policy(&env, id, &policy);
        set_policy_count(&env, id);
        env.events()
            .publish((symbol_short!("policy"),), (id, holder, product_id));
        Ok(id)
    }

    pub fn get_policy(env: Env, policy_id: u32) -> Result<Policy, Error> {
        get_policy(&env, policy_id)
    }

    pub fn policy_count(env: Env) -> u32 {
        get_policy_count(&env)
    }

    // ── Claim processing ──────────────────────────────────────────────────────

    /// Attempt to process a parametric payout for `policy_id`.
    ///
    /// The function:
    /// 1. Checks the policy is active and not expired.
    /// 2. Fetches the latest oracle reading for the product's parameter.
    /// 3. Evaluates the trigger condition.
    /// 4. If triggered, records the payout; otherwise returns `TriggerNotMet`.
    ///
    /// Anyone may call this — no policyholder signature required.
    pub fn process_claim(env: Env, policy_id: u32) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        let mut policy = get_policy(&env, policy_id)?;

        if policy.status != PolicyStatus::Active {
            if policy.status == PolicyStatus::Claimed {
                return Err(Error::PolicyAlreadyClaimed);
            }
            return Err(Error::PolicyNotActive);
        }

        let now = env.ledger().timestamp();
        if now > policy.expires_at {
            policy.status = PolicyStatus::Expired;
            set_policy(&env, policy_id, &policy);
            return Err(Error::PolicyExpired);
        }

        let product = get_product(&env, policy.product_id)?;

        let reading = get_oracle_reading(&env, &product.oracle, &product.parameter_key)
            .ok_or(Error::OracleDataStale)?;

        if now.saturating_sub(reading.timestamp) > MAX_ORACLE_STALENESS_SECS {
            return Err(Error::OracleDataStale);
        }

        let triggered = match product.trigger_direction {
            TriggerDirection::AtOrAbove => reading.value >= product.trigger_threshold,
            TriggerDirection::AtOrBelow => reading.value <= product.trigger_threshold,
        };

        if !triggered {
            return Err(Error::TriggerNotMet);
        }

        let payout = policy.coverage_amount;
        policy.status = PolicyStatus::Claimed;
        policy.trigger_value = Some(reading.value);
        policy.payout_amount = Some(payout);
        set_policy(&env, policy_id, &policy);

        env.events().publish(
            (symbol_short!("payout"), policy_id),
            (policy.holder, payout, reading.value),
        );

        Ok(payout)
    }

    /// Expire a policy that has passed its term without a triggered payout.
    pub fn expire_policy(env: Env, policy_id: u32) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        let mut policy = get_policy(&env, policy_id)?;
        if policy.status != PolicyStatus::Active {
            return Err(Error::PolicyNotActive);
        }
        if env.ledger().timestamp() <= policy.expires_at {
            return Err(Error::PolicyExpired);
        }
        policy.status = PolicyStatus::Expired;
        set_policy(&env, policy_id, &policy);
        env.events()
            .publish((symbol_short!("expired"),), policy_id);
        Ok(())
    }

    // ── Read-only helpers ─────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_oracle(env: Env, oracle: Address) -> bool {
        is_oracle(&env, &oracle)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
