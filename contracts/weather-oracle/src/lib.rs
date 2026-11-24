// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Weather Oracle Contract
//!
//! Provides tamper-resistant weather data for Soroban applications.
//! Supports multiple data sources, multi-source verification thresholds,
//! outlier detection, and circuit breakers for safety.
//!
//! ## Lifecycle
//! 1. Admin calls `initialize`.
//! 2. Admin adds trusted data sources via `add_data_source`.
//! 3. Sources submit weather readings via `submit_weather_data`.
//!    - On first submission a new record is created (status: Pending).
//!    - Subsequent source submissions confirm the record; once confirmations
//!      reach the threshold the record becomes Verified automatically.
//! 4. Consumers call `get_weather_data` / `get_historical_data`.
//! 5. Admin can `set_verification_threshold`, `remove_data_source`,
//!    `trigger_circuit_breaker`, `pause`, or `unpause` at any time.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_epoch_consensus, get_epoch_reports, get_history_index, get_record,
    get_record_count, get_source, get_threshold, has_submitted, is_circuit_breaker_active,
    is_initialized, is_paused, mark_submitted, set_admin, set_circuit_breaker, set_epoch_consensus,
    set_epoch_reports, set_history_index, set_initialized, set_paused, set_record,
    set_record_count, set_source, set_threshold, source_exists,
};
use crate::types::{
    DataSource, EpochConsensus, EpochReport, Error, WeatherData, WeatherDataStatus,
};

// ── Validation constants ───────────────────────────────────────────────────────
/// Maximum allowed timestamp staleness: 24 hours (in seconds)
pub const MAX_STALENESS_SECONDS: u64 = 86_400;
/// Temperature range: −90°C to +60°C (in fixed-point × 100: −9000 to 6000)
const TEMP_MIN: i32 = -9000;
const TEMP_MAX: i32 = 6000;
/// Humidity: 0–100 % (× 100: 0 to 10_000)
const HUMIDITY_MIN: i32 = 0;
const HUMIDITY_MAX: i32 = 10_000;
/// Wind speed: 0–500 km/h (× 100: 0 to 50_000)
const WIND_MIN: i32 = 0;
const WIND_MAX: i32 = 50_000;

#[contract]
pub struct WeatherOracle;

#[contractimpl]
impl WeatherOracle {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract. Can only be called once.
    ///
    /// `verification_threshold`: minimum number of source confirmations before
    /// a record is marked `Verified`. Defaults to 2 if `None`.
    pub fn initialize(
        env: Env,
        admin: Address,
        verification_threshold: Option<u32>,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_initialized(&env);
        if let Some(t) = verification_threshold {
            if t == 0 {
                return Err(Error::InvalidThreshold);
            }
            set_threshold(&env, t);
        }
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Admin: pause / unpause ────────────────────────────────────────────────

    /// Pause all state-changing operations.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), admin);
        Ok(())
    }

    /// Resume operations.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), admin);
        Ok(())
    }

    // ── Admin: circuit breaker ────────────────────────────────────────────────

    /// Activate or deactivate the circuit breaker.
    /// While active, `submit_weather_data` is blocked.
    pub fn set_circuit_breaker(env: Env, admin: Address, active: bool) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        set_circuit_breaker(&env, active);
        env.events()
            .publish((symbol_short!("circuit"),), (admin, active));
        Ok(())
    }

    // ── Admin: source management ──────────────────────────────────────────────

    /// Register a trusted data source.
    pub fn add_data_source(
        env: Env,
        admin: Address,
        source: Address,
        name: String,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if name.is_empty() {
            return Err(Error::EmptyLocation); // reuse; name must not be blank
        }
        if source_exists(&env, &source) {
            return Err(Error::SourceAlreadyExists);
        }
        let ds = DataSource {
            address: source.clone(),
            name,
            active: true,
            submissions: 0,
        };
        set_source(&env, &ds);
        env.events().publish((symbol_short!("srcAdd"),), source);
        Ok(())
    }

    /// Deactivate (or reactivate) a data source. Does not delete history.
    pub fn remove_data_source(
        env: Env,
        admin: Address,
        source: Address,
        active: bool,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        let mut ds = get_source(&env, &source)?;
        ds.active = active;
        set_source(&env, &ds);
        env.events()
            .publish((symbol_short!("srcUpd"),), (source, active));
        Ok(())
    }

    // ── Admin: threshold ──────────────────────────────────────────────────────

    /// Update the number of confirmations required for verification.
    pub fn set_verification_threshold(
        env: Env,
        admin: Address,
        threshold: u32,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if threshold == 0 {
            return Err(Error::InvalidThreshold);
        }
        set_threshold(&env, threshold);
        env.events().publish((symbol_short!("thresh"),), threshold);
        Ok(())
    }

    // ── Data submission ───────────────────────────────────────────────────────

    /// Submit weather data for a location.
    ///
    /// Values use fixed-point × 100:
    /// - `temperature_c`: e.g. 2150 = 21.50°C
    /// - `humidity_pct`:  e.g. 6500 = 65.00 %
    /// - `wind_speed_kmh`: e.g. 1500 = 15.00 km/h
    ///
    /// If no record exists for `(location, observed_at)` a new one is created.
    /// Otherwise the existing record gains a confirmation. Returns the record ID.
    pub fn submit_weather_data(
        env: Env,
        source: Address,
        location: String,
        temperature_c: i32,
        humidity_pct: i32,
        wind_speed_kmh: i32,
        observed_at: u64,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        not_circuit_breaker(&env)?;
        source.require_auth();

        // Validate source
        let mut ds = get_source(&env, &source)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }

        // Validate inputs
        validate_inputs(
            &location,
            temperature_c,
            humidity_pct,
            wind_speed_kmh,
            observed_at,
        )?;

        let record_id = match get_history_index(&env, &location, observed_at) {
            Some(existing_id) => {
                // Existing record: add confirmation if not already submitted
                if has_submitted(&env, existing_id, &source) {
                    return Err(Error::AlreadySubmitted);
                }
                let mut record = get_record(&env, existing_id)?;
                record.confirmations += 1;
                if record.status == WeatherDataStatus::Pending
                    && record.confirmations >= get_threshold(&env)
                {
                    record.status = WeatherDataStatus::Verified;
                    env.events().publish(
                        (symbol_short!("verified"),),
                        (existing_id, record.confirmations),
                    );
                }
                mark_submitted(&env, existing_id, &source);
                set_record(&env, &record);
                existing_id
            }
            None => {
                // New record
                let id = get_record_count(&env);
                let now = env.ledger().timestamp();
                let record = WeatherData {
                    id,
                    location: location.clone(),
                    temperature_c,
                    humidity_pct,
                    wind_speed_kmh,
                    observed_at,
                    submitted_at: now,
                    confirmations: 1,
                    status: WeatherDataStatus::Pending,
                };
                set_record(&env, &record);
                set_record_count(&env, id + 1);
                set_history_index(&env, &location, observed_at, id);
                mark_submitted(&env, id, &source);
                env.events()
                    .publish((symbol_short!("wSubmit"),), (id, location));
                id
            }
        };

        ds.submissions += 1;
        set_source(&env, &ds);

        Ok(record_id)
    }

    // ── Parametric Weather Consensus & IQR Outlier Trimming ───────────────────

    /// Submit weather report for parametric multi-source consensus epoch.
    pub fn report_weather(
        env: Env,
        reporter: Address,
        station_id: u32,
        rainfall_mm: u32,
        epoch: u64,
    ) -> Result<(), Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        not_circuit_breaker(&env)?;
        reporter.require_auth();

        let ds = get_source(&env, &reporter)?;
        if !ds.active {
            return Err(Error::SourceInactive);
        }

        let now = env.ledger().timestamp();
        if now.saturating_sub(epoch) > MAX_STALENESS_SECONDS {
            return Err(Error::StaleData);
        }

        let mut reports = get_epoch_reports(&env, station_id, epoch);
        for r in reports.iter() {
            if r.reporter == reporter {
                return Err(Error::AlreadySubmitted);
            }
        }

        reports.push_back(EpochReport {
            reporter: reporter.clone(),
            station_id,
            rainfall_mm,
            observed_at: epoch,
        });
        set_epoch_reports(&env, station_id, epoch, &reports);

        env.events().publish(
            (symbol_short!("rainRep"), station_id),
            (reporter, rainfall_mm, epoch),
        );

        Ok(())
    }

    /// Finalize consensus for an epoch requiring at least K of N reports and applying IQR trimming.
    pub fn finalize_epoch_consensus(
        env: Env,
        station_id: u32,
        epoch: u64,
    ) -> Result<EpochConsensus, Error> {
        ensure_initialized(&env)?;
        not_paused(&env)?;
        not_circuit_breaker(&env)?;

        let reports = get_epoch_reports(&env, station_id, epoch);
        let k = get_threshold(&env);
        let total = reports.len();
        if total < k {
            return Err(Error::ConsensusNotReached);
        }

        // Collect rainfall values into a sortable list
        let mut vals: soroban_sdk::Vec<u32> = soroban_sdk::Vec::new(&env);
        for r in reports.iter() {
            vals.push_back(r.rainfall_mm);
        }

        // In-place sort for no_std
        let n = vals.len();
        for i in 0..n {
            for j in 0..(n - 1 - i) {
                let a = vals.get(j).unwrap();
                let b = vals.get(j + 1).unwrap();
                if a > b {
                    vals.set(j, b);
                    vals.set(j + 1, a);
                }
            }
        }

        // Compute Q1 (25th percentile) and Q3 (75th percentile)
        let q1_idx = n / 4;
        let q3_idx = (3 * n) / 4;
        let q1 = vals.get(q1_idx).unwrap();
        let q3 = vals.get(q3_idx).unwrap();
        let iqr = q3.saturating_sub(q1);

        // 1.5 * IQR = (3 * iqr) / 2
        let step = (3 * iqr) / 2;
        let lower_bound = q1.saturating_sub(step);
        let upper_bound = q3.saturating_add(step);

        let mut valid_vals: soroban_sdk::Vec<u32> = soroban_sdk::Vec::new(&env);
        for v in vals.iter() {
            if v >= lower_bound && v <= upper_bound {
                valid_vals.push_back(v);
            }
        }

        let valid_count = valid_vals.len();
        if valid_count == 0 {
            return Err(Error::OutlierFiltered);
        }

        // Trimmed median
        let median_idx = valid_count / 2;
        let trimmed_median = valid_vals.get(median_idx).unwrap();

        let consensus = EpochConsensus {
            station_id,
            epoch,
            total_reports: total,
            valid_reports: valid_count,
            trimmed_median_rainfall: trimmed_median,
            finalized_at: env.ledger().timestamp(),
        };

        set_epoch_consensus(&env, station_id, epoch, &consensus);

        env.events().publish(
            (symbol_short!("rainCons"), station_id),
            (epoch, trimmed_median, valid_count),
        );

        Ok(consensus)
    }

    /// Retrieve finalized epoch consensus benchmark.
    pub fn get_epoch_consensus(
        env: Env,
        station_id: u32,
        epoch: u64,
    ) -> Result<EpochConsensus, Error> {
        ensure_initialized(&env)?;
        get_epoch_consensus(&env, station_id, epoch)
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    /// Retrieve a weather record by ID.
    pub fn get_weather_data(env: Env, record_id: u32) -> Result<WeatherData, Error> {
        ensure_initialized(&env)?;
        get_record(&env, record_id)
    }

    /// Look up a historical record by location and observation timestamp.
    pub fn get_historical_data(
        env: Env,
        location: String,
        observed_at: u64,
    ) -> Result<WeatherData, Error> {
        ensure_initialized(&env)?;
        let id = get_history_index(&env, &location, observed_at).ok_or(Error::RecordNotFound)?;
        get_record(&env, id)
    }

    /// Return the total number of weather records submitted.
    pub fn get_record_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_record_count(&env))
    }

    /// Return the current verification threshold.
    pub fn get_verification_threshold(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_threshold(&env))
    }

    /// Return source metadata.
    pub fn get_data_source(env: Env, source: Address) -> Result<DataSource, Error> {
        ensure_initialized(&env)?;
        get_source(&env, &source)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn is_circuit_breaker_active(env: Env) -> bool {
        is_circuit_breaker_active(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}

fn not_circuit_breaker(env: &Env) -> Result<(), Error> {
    if is_circuit_breaker_active(env) {
        return Err(Error::CircuitBreakerActive);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

/// Validate all weather measurement inputs.
fn validate_inputs(
    location: &String,
    temperature_c: i32,
    humidity_pct: i32,
    wind_speed_kmh: i32,
    observed_at: u64,
) -> Result<(), Error> {
    if location.is_empty() {
        return Err(Error::EmptyLocation);
    }
    if temperature_c < TEMP_MIN || temperature_c > TEMP_MAX {
        return Err(Error::InvalidTemperature);
    }
    if humidity_pct < HUMIDITY_MIN || humidity_pct > HUMIDITY_MAX {
        return Err(Error::InvalidHumidity);
    }
    if wind_speed_kmh < WIND_MIN || wind_speed_kmh > WIND_MAX {
        return Err(Error::InvalidWindSpeed);
    }
    if observed_at == 0 {
        return Err(Error::InvalidTimestamp);
    }
    Ok(())
}
