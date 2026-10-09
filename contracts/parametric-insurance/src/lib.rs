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

use soroban_sdk::{
    contract, contractclient, contractimpl, symbol_short, token, vec, Address, Env, String, Vec,
};

use crate::storage::{
    get_admin, get_crop_terms, get_oracle_reading, get_policy, get_policy_count, get_product,
    get_product_count, get_reserve_config, get_total_reserved, has_crop_terms, has_reserve_config,
    is_initialized, is_oracle, is_policy_funded, set_admin, set_crop_terms, set_oracle,
    set_oracle_reading, set_policy, set_policy_count, set_policy_funded, set_product,
    set_product_count, set_reserve_config, set_total_reserved,
};
pub use crate::types::{
    CropProductConfig, CropTerms, DataSourceType, Error, OracleReading, Policy, PolicyStatus,
    Product, ProductConfig, ReserveConfig, SatelliteWeatherData, TriggerDirection,
    WeatherDataStatus,
};

/// Maximum staleness window for oracle data (24 hours).
const MAX_ORACLE_STALENESS_SECS: u64 = 86_400;
const MAX_CROP_OBSERVATION_AGE_SECS: u64 = 7 * 86_400;

/// Read-only interface implemented by `contracts/weather-data-oracle`.
#[contractclient(name = "SatelliteOracleClient")]
pub trait SatelliteOracle {
    fn get_weather_data(env: Env, data_id: u32) -> SatelliteWeatherData;
}

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
    pub fn set_oracle(
        env: Env,
        admin: Address,
        oracle: Address,
        active: bool,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_oracle(&env, &oracle, active);
        env.events()
            .publish((symbol_short!("oracle"),), (oracle, active));
        Ok(())
    }

    /// Oracle submits a reading for a specific parameter with verification metadata.
    pub fn submit_reading(
        env: Env,
        oracle: Address,
        parameter_key: String,
        value: i128,
        source_type: DataSourceType,
        status: WeatherDataStatus,
        confirmations: u32,
        location: Option<String>,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        oracle.require_auth();
        if !is_oracle(&env, &oracle) {
            return Err(Error::UnknownOracle);
        }
        let now = env.ledger().timestamp();
        let reading = OracleReading {
            parameter_key: parameter_key.clone(),
            value,
            timestamp: now,
            source_type: source_type.clone(),
            status: status.clone(),
            confirmations,
            location: location.clone(),
        };
        set_oracle_reading(&env, &oracle, &parameter_key, &reading);
        env.events().publish(
            (symbol_short!("reading"),),
            (oracle, parameter_key, value, source_type, status),
        );
        Ok(())
    }

    pub fn get_reading(env: Env, oracle: Address, parameter_key: String) -> Option<OracleReading> {
        get_oracle_reading(&env, &oracle, &parameter_key)
    }

    // ── Token-backed reserve ──────────────────────────────────────────────────

    /// Configure the settlement token once. This does not affect legacy,
    /// accounting-only policies.
    pub fn configure_reserve(
        env: Env,
        admin: Address,
        settlement_token: Address,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if has_reserve_config(&env) {
            return Err(Error::ReserveAlreadyConfigured);
        }
        set_reserve_config(&env, &ReserveConfig { settlement_token });
        set_total_reserved(&env, 0);
        env.events().publish((symbol_short!("reserve"),), admin);
        Ok(())
    }

    /// Add settlement tokens to the claims reserve. Any account may fund it.
    pub fn fund_reserve(env: Env, funder: Address, amount: i128) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        funder.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidConfig);
        }
        let config = get_reserve_config(&env)?;
        token::Client::new(&env, &config.settlement_token).transfer(
            &funder,
            &env.current_contract_address(),
            &amount,
        );
        env.events()
            .publish((symbol_short!("reserve"),), (funder, amount));
        Ok(())
    }

    /// Withdraw only reserve funds not committed to active crop policies.
    pub fn withdraw_excess_reserve(env: Env, admin: Address, amount: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::InvalidConfig);
        }
        let config = get_reserve_config(&env)?;
        let token_client = token::Client::new(&env, &config.settlement_token);
        let balance = token_client.balance(&env.current_contract_address());
        let available = balance
            .checked_sub(get_total_reserved(&env))
            .ok_or(Error::Overflow)?;
        if amount > available {
            return Err(Error::InsufficientReserve);
        }
        token_client.transfer(&env.current_contract_address(), &admin, &amount);
        env.events().publish((symbol_short!("withdraw"),), amount);
        Ok(())
    }

    // ── Product management (admin) ────────────────────────────────────────────

    /// Create a new insurance product. Returns the product ID.
    pub fn create_product(env: Env, admin: Address, config: ProductConfig) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if config.name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if config.premium <= 0 {
            return Err(Error::ZeroPremium);
        }
        if config.coverage_amount <= 0 {
            return Err(Error::ZeroCoverage);
        }
        if config.term_secs == 0 {
            return Err(Error::InvalidTrigger);
        }
        if config.authorized_sources.is_empty() {
            return Err(Error::InvalidConfig);
        }
        if config.min_confirmations == 0 {
            return Err(Error::InvalidConfig);
        }

        let id = get_product_count(&env) + 1;
        let product = Product {
            name: config.name,
            premium: config.premium,
            coverage_amount: config.coverage_amount,
            oracle: config.oracle,
            parameter_key: config.parameter_key,
            trigger_threshold: config.trigger_threshold,
            trigger_direction: config.trigger_direction,
            term_secs: config.term_secs,
            is_active: true,
            authorized_sources: config.authorized_sources,
            min_confirmations: config.min_confirmations,
            required_location: config.required_location,
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

    /// Create a new crop insurance product. Returns the product ID.
    pub fn create_crop_product(
        env: Env,
        admin: Address,
        config: CropProductConfig,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if config.name.is_empty() || config.region.is_empty() {
            return Err(Error::EmptyName);
        }
        if config.premium <= 0 {
            return Err(Error::ZeroPremium);
        }
        if config.coverage_amount <= 0 {
            return Err(Error::ZeroCoverage);
        }
        if config.rainfall_threshold < 0
            || config.term_secs == 0
            || config.max_observation_age == 0
            || config.max_observation_age > MAX_CROP_OBSERVATION_AGE_SECS
            || config.min_confirmations == 0
        {
            return Err(Error::InvalidConfig);
        }
        let id = get_product_count(&env)
            .checked_add(1)
            .ok_or(Error::Overflow)?;
        let product = Product {
            name: config.name,
            premium: config.premium,
            coverage_amount: config.coverage_amount,
            oracle: config.satellite_oracle,
            parameter_key: String::from_str(&env, "SAT_RAIN"),
            trigger_threshold: config.rainfall_threshold,
            trigger_direction: config.trigger_direction,
            term_secs: config.term_secs,
            is_active: true,
            authorized_sources: vec![&env, DataSourceType::Satellite],
            min_confirmations: config.min_confirmations,
            required_location: Some(config.region.clone()),
        };
        set_product(&env, id, &product);
        set_crop_terms(
            &env,
            id,
            &CropTerms {
                region: config.region,
                max_observation_age: config.max_observation_age,
            },
        );
        set_product_count(&env, id);
        env.events().publish((symbol_short!("crop_prod"),), id);
        Ok(id)
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
        if has_crop_terms(&env, product_id) {
            return Err(Error::SatelliteDataRequired);
        }

        let now = env.ledger().timestamp();
        let id = get_policy_count(&env)
            .checked_add(1)
            .ok_or(Error::Overflow)?;
        let expires_at = now.checked_add(product.term_secs).ok_or(Error::Overflow)?;
        let policy = Policy {
            product_id,
            holder: holder.clone(),
            premium_paid: product.premium,
            coverage_amount: product.coverage_amount,
            purchased_at: now,
            expires_at,
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

    /// Purchase a token-backed crop policy and reserve its full coverage.
    pub fn buy_crop_policy(env: Env, holder: Address, product_id: u32) -> Result<u32, Error> {
        Self::assert_initialized(&env)?;
        holder.require_auth();
        get_crop_terms(&env, product_id)?;
        let product = get_product(&env, product_id)?;
        if !product.is_active {
            return Err(Error::ProductInactive);
        }
        let config = get_reserve_config(&env)?;
        let now = env.ledger().timestamp();
        let expires_at = now.checked_add(product.term_secs).ok_or(Error::Overflow)?;
        let id = get_policy_count(&env)
            .checked_add(1)
            .ok_or(Error::Overflow)?;
        let new_reserved = get_total_reserved(&env)
            .checked_add(product.coverage_amount)
            .ok_or(Error::Overflow)?;
        let token_client = token::Client::new(&env, &config.settlement_token);
        token_client.transfer(&holder, &env.current_contract_address(), &product.premium);
        if token_client.balance(&env.current_contract_address()) < new_reserved {
            return Err(Error::InsufficientReserve);
        }
        let policy = Policy {
            product_id,
            holder: holder.clone(),
            premium_paid: product.premium,
            coverage_amount: product.coverage_amount,
            purchased_at: now,
            expires_at,
            status: PolicyStatus::Active,
            trigger_value: None,
            payout_amount: None,
        };
        set_policy(&env, id, &policy);
        set_policy_funded(&env, id, true);
        set_total_reserved(&env, new_reserved);
        set_policy_count(&env, id);
        env.events().publish((symbol_short!("cropbuy"), id), holder);
        Ok(id)
    }

    // ── Claim processing ──────────────────────────────────────────────────────

    /// Attempt to process a parametric payout for `policy_id`.
    ///
    /// The function:
    /// 1. Checks the policy is active and not expired.
    /// 2. Fetches the latest oracle reading for the product's parameter.
    /// 3. Verifies the oracle reading (status, confirmations, source type, location, timestamp).
    /// 4. Evaluates the trigger condition.
    /// 5. If triggered, records the payout; otherwise returns `TriggerNotMet`.
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

        if has_crop_terms(&env, policy.product_id) {
            return Err(Error::SatelliteDataRequired);
        }

        let reading = get_oracle_reading(&env, &product.oracle, &product.parameter_key)
            .ok_or(Error::OracleDataStale)?;

        // Verify oracle reading status
        if reading.status != WeatherDataStatus::Verified
            && reading.status != WeatherDataStatus::Finalized
        {
            return Err(Error::UnverifiedOracleData);
        }

        // Verify confirmations meet product minimum
        if reading.confirmations < product.min_confirmations {
            return Err(Error::InsufficientConfirmations);
        }

        // Verify data source is authorized
        if !product.authorized_sources.contains(&reading.source_type) {
            return Err(Error::UnauthorizedDataSource);
        }

        // Verify location if required
        if let Some(required_loc) = &product.required_location {
            if let Some(reading_loc) = &reading.location {
                if reading_loc != required_loc {
                    return Err(Error::WrongRegion);
                }
            } else {
                return Err(Error::WrongRegion);
            }
        }

        // Verify timestamp is not in the future and not too old
        if reading.timestamp > now {
            return Err(Error::InvalidTimestamp);
        }
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

    /// Process a crop claim against a verified/finalized satellite observation
    /// fetched directly from the configured weather-oracle contract.
    pub fn process_satellite_claim(
        env: Env,
        policy_id: u32,
        weather_data_id: u32,
    ) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        let mut policy = get_policy(&env, policy_id)?;
        if policy.status != PolicyStatus::Active {
            if policy.status == PolicyStatus::Claimed {
                return Err(Error::PolicyAlreadyClaimed);
            }
            return Err(Error::PolicyNotActive);
        }
        if !is_policy_funded(&env, policy_id) {
            return Err(Error::PolicyNotFunded);
        }
        let now = env.ledger().timestamp();
        if now > policy.expires_at {
            return Err(Error::PolicyExpired);
        }
        let product = get_product(&env, policy.product_id)?;
        let terms = get_crop_terms(&env, policy.product_id)?;
        let reading =
            SatelliteOracleClient::new(&env, &product.oracle).get_weather_data(&weather_data_id);
        if (reading.status != WeatherDataStatus::Verified
            && reading.status != WeatherDataStatus::Finalized)
            || reading.source_type != DataSourceType::Satellite
            || reading.confirmations == 0
        {
            return Err(Error::InvalidOracleData);
        }
        if reading.location != terms.region {
            return Err(Error::WrongRegion);
        }
        if reading.timestamp < policy.purchased_at
            || reading.timestamp > now
            || reading.timestamp > policy.expires_at
            || now.saturating_sub(reading.timestamp) > terms.max_observation_age
        {
            return Err(Error::InvalidObservation);
        }

        let rainfall = reading.precipitation as i128;
        let triggered = match product.trigger_direction {
            TriggerDirection::AtOrAbove => rainfall >= product.trigger_threshold,
            TriggerDirection::AtOrBelow => rainfall <= product.trigger_threshold,
        };
        if !triggered {
            return Err(Error::TriggerNotMet);
        }

        policy.status = PolicyStatus::Claimed;
        policy.trigger_value = Some(rainfall);
        policy.payout_amount = Some(policy.coverage_amount);
        set_policy(&env, policy_id, &policy);
        Self::release_reserved_coverage(&env, policy.coverage_amount)?;
        set_policy_funded(&env, policy_id, false);
        let config = get_reserve_config(&env)?;
        token::Client::new(&env, &config.settlement_token).transfer(
            &env.current_contract_address(),
            &policy.holder,
            &policy.coverage_amount,
        );
        env.events().publish(
            (symbol_short!("satclaim"), policy_id),
            (
                weather_data_id,
                policy.holder,
                policy.coverage_amount,
                rainfall,
            ),
        );
        Ok(policy.coverage_amount)
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
        if is_policy_funded(&env, policy_id) {
            Self::release_reserved_coverage(&env, policy.coverage_amount)?;
            set_policy_funded(&env, policy_id, false);
        }
        env.events().publish((symbol_short!("expired"),), policy_id);
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

    pub fn get_crop_terms(env: Env, product_id: u32) -> Result<CropTerms, Error> {
        get_crop_terms(&env, product_id)
    }

    pub fn get_reserve_config(env: Env) -> Result<ReserveConfig, Error> {
        get_reserve_config(&env)
    }

    pub fn get_total_reserved(env: Env) -> i128 {
        get_total_reserved(&env)
    }

    pub fn is_policy_funded(env: Env, policy_id: u32) -> bool {
        is_policy_funded(&env, policy_id)
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

    fn release_reserved_coverage(env: &Env, amount: i128) -> Result<(), Error> {
        let total_reserved = get_total_reserved(env);
        if amount < 0 || amount > total_reserved {
            return Err(Error::Overflow);
        }
        let updated = total_reserved.checked_sub(amount).ok_or(Error::Overflow)?;
        set_total_reserved(env, updated);
        Ok(())
    }
}
