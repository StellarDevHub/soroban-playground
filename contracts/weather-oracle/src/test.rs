// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String};

use crate::types::{Error, WeatherDataStatus};
use crate::{WeatherOracle, WeatherOracleClient};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, Address, WeatherOracleClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, WeatherOracle);
    let client = WeatherOracleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn loc(env: &Env) -> String {
    String::from_str(env, "Berlin")
}

fn src_name(env: &Env) -> String {
    String::from_str(env, "GroundStation-1")
}

// Observed-at timestamp: non-zero, arbitrary
const OBS: u64 = 1_700_000_000;
// Typical readings (fixed-point × 100)
const TEMP: i32 = 2150; // 21.50 °C
const HUM: i32 = 6500; // 65.00 %
const WIND: i32 = 1500; // 15.00 km/h

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    assert_eq!(client.get_admin().unwrap(), admin);
}

#[test]
fn test_initialize_sets_default_threshold() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    assert_eq!(client.get_verification_threshold().unwrap(), 2);
}

#[test]
fn test_initialize_custom_threshold() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &Some(3)).unwrap();
    assert_eq!(client.get_verification_threshold().unwrap(), 3);
}

#[test]
fn test_initialize_twice_fails() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let err = client.initialize(&admin, &None).unwrap_err();
    assert_eq!(err, Error::AlreadyInitialized);
}

#[test]
fn test_initialize_zero_threshold_fails() {
    let (_, admin, client) = setup();
    let err = client.initialize(&admin, &Some(0)).unwrap_err();
    assert_eq!(err, Error::InvalidThreshold);
}

// ── pause / unpause ───────────────────────────────────────────────────────────

#[test]
fn test_pause_unpause() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    assert!(!client.is_paused());
    client.pause(&admin).unwrap();
    assert!(client.is_paused());
    client.unpause(&admin).unwrap();
    assert!(!client.is_paused());
}

#[test]
fn test_pause_blocks_source_add() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    client.pause(&admin).unwrap();
    let src = Address::generate(&env);
    let err = client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap_err();
    assert_eq!(err, Error::ContractPaused);
}

#[test]
fn test_pause_blocks_submit() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client.pause(&admin).unwrap();
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::ContractPaused);
}

// ── circuit breaker ───────────────────────────────────────────────────────────

#[test]
fn test_circuit_breaker_blocks_submit() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client.set_circuit_breaker(&admin, &true).unwrap();
    assert!(client.is_circuit_breaker_active());
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::CircuitBreakerActive);
}

#[test]
fn test_circuit_breaker_deactivate_allows_submit() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client.set_circuit_breaker(&admin, &true).unwrap();
    client.set_circuit_breaker(&admin, &false).unwrap();
    assert!(!client.is_circuit_breaker_active());
    // Should succeed now
    client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
}

// ── source management ─────────────────────────────────────────────────────────

#[test]
fn test_add_data_source_stores_data() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let ds = client.get_data_source(&src).unwrap();
    assert_eq!(ds.address, src);
    assert!(ds.active);
    assert_eq!(ds.submissions, 0);
}

#[test]
fn test_add_duplicate_source_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let err = client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap_err();
    assert_eq!(err, Error::SourceAlreadyExists);
}

#[test]
fn test_remove_data_source_deactivates() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client.remove_data_source(&admin, &src, &false).unwrap();
    let ds = client.get_data_source(&src).unwrap();
    assert!(!ds.active);
}

#[test]
fn test_inactive_source_submit_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client.remove_data_source(&admin, &src, &false).unwrap();
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::SourceInactive);
}

#[test]
fn test_unknown_source_submit_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::SourceNotFound);
}

#[test]
fn test_non_admin_cannot_add_source() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let rogue = Address::generate(&env);
    let src = Address::generate(&env);
    let err = client
        .add_data_source(&rogue, &src, &src_name(&env))
        .unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

// ── submit_weather_data ───────────────────────────────────────────────────────

#[test]
fn test_submit_creates_record() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let id = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    assert_eq!(id, 0);
    let r = client.get_weather_data(&0).unwrap();
    assert_eq!(r.temperature_c, TEMP);
    assert_eq!(r.humidity_pct, HUM);
    assert_eq!(r.wind_speed_kmh, WIND);
    assert_eq!(r.observed_at, OBS);
    assert_eq!(r.confirmations, 1);
    assert_eq!(r.status, WeatherDataStatus::Pending);
}

#[test]
fn test_submit_increments_source_submissions() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    let ds = client.get_data_source(&src).unwrap();
    assert_eq!(ds.submissions, 1);
}

#[test]
fn test_confirmation_verifies_record() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(2)).unwrap();
    let src1 = Address::generate(&env);
    let src2 = Address::generate(&env);
    client
        .add_data_source(&admin, &src1, &src_name(&env))
        .unwrap();
    client
        .add_data_source(&admin, &src2, &String::from_str(&env, "Satellite-1"))
        .unwrap();
    client
        .submit_weather_data(&src1, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    // still pending after 1 confirmation
    assert_eq!(
        client.get_weather_data(&0).unwrap().status,
        WeatherDataStatus::Pending
    );
    client
        .submit_weather_data(&src2, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    // verified after reaching threshold
    assert_eq!(
        client.get_weather_data(&0).unwrap().status,
        WeatherDataStatus::Verified
    );
}

#[test]
fn test_duplicate_submission_from_same_source_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::AlreadySubmitted);
}

#[test]
fn test_record_count_increments() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    assert_eq!(client.get_record_count().unwrap(), 0);
    client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    assert_eq!(client.get_record_count().unwrap(), 1);
    // Different observed_at → new record
    client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &(OBS + 3600))
        .unwrap();
    assert_eq!(client.get_record_count().unwrap(), 2);
}

#[test]
fn test_multiple_sources_three_threshold() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(3)).unwrap();
    let sources = [
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];
    for (i, src) in sources.iter().enumerate() {
        let name = if i == 0 {
            String::from_str(&env, "SrcA")
        } else if i == 1 {
            String::from_str(&env, "SrcB")
        } else {
            String::from_str(&env, "SrcC")
        };
        client.add_data_source(&admin, src, &name).unwrap();
    }
    client
        .submit_weather_data(&sources[0], &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    client
        .submit_weather_data(&sources[1], &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    assert_eq!(
        client.get_weather_data(&0).unwrap().status,
        WeatherDataStatus::Pending
    );
    client
        .submit_weather_data(&sources[2], &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    assert_eq!(
        client.get_weather_data(&0).unwrap().status,
        WeatherDataStatus::Verified
    );
    let r = client.get_weather_data(&0).unwrap();
    assert_eq!(r.confirmations, 3);
}

// ── get_historical_data ───────────────────────────────────────────────────────

#[test]
fn test_get_historical_data() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    let r = client.get_historical_data(&loc(&env), &OBS).unwrap();
    assert_eq!(r.id, 0);
    assert_eq!(r.temperature_c, TEMP);
}

#[test]
fn test_get_historical_data_not_found() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let err = client.get_historical_data(&loc(&env), &OBS).unwrap_err();
    assert_eq!(err, Error::RecordNotFound);
}

// ── Input validation ──────────────────────────────────────────────────────────

#[test]
fn test_submit_invalid_temperature_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    // too hot
    let err = client
        .submit_weather_data(&src, &loc(&env), &6001, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::InvalidTemperature);
    // too cold
    let err = client
        .submit_weather_data(&src, &loc(&env), &-9001, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::InvalidTemperature);
}

#[test]
fn test_submit_invalid_humidity_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &10_001, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::InvalidHumidity);
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &-1, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::InvalidHumidity);
}

#[test]
fn test_submit_invalid_wind_speed_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &50_001, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::InvalidWindSpeed);
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &-1, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::InvalidWindSpeed);
}

#[test]
fn test_submit_empty_location_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let empty = String::from_str(&env, "");
    let err = client
        .submit_weather_data(&src, &empty, &TEMP, &HUM, &WIND, &OBS)
        .unwrap_err();
    assert_eq!(err, Error::EmptyLocation);
}

#[test]
fn test_submit_zero_timestamp_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let err = client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &0)
        .unwrap_err();
    assert_eq!(err, Error::InvalidTimestamp);
}

// ── set_verification_threshold ────────────────────────────────────────────────

#[test]
fn test_set_threshold_updates_value() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &Some(2)).unwrap();
    client.set_verification_threshold(&admin, &5).unwrap();
    assert_eq!(client.get_verification_threshold().unwrap(), 5);
}

#[test]
fn test_set_zero_threshold_fails() {
    let (_, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let err = client.set_verification_threshold(&admin, &0).unwrap_err();
    assert_eq!(err, Error::InvalidThreshold);
}

#[test]
fn test_non_admin_cannot_set_threshold() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let rogue = Address::generate(&env);
    let err = client.set_verification_threshold(&rogue, &5).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

// ── uninitialised guard ───────────────────────────────────────────────────────

#[test]
fn test_get_weather_data_before_init_fails() {
    let (_, _, client) = setup();
    let err = client.get_weather_data(&0).unwrap_err();
    assert_eq!(err, Error::NotInitialized);
}

#[test]
fn test_get_record_count_before_init_fails() {
    let (_, _, client) = setup();
    let err = client.get_record_count().unwrap_err();
    assert_eq!(err, Error::NotInitialized);
}

// ── boundary / edge cases ─────────────────────────────────────────────────────

#[test]
fn test_submit_boundary_temperature_values() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    // min valid temp
    client
        .submit_weather_data(&src, &loc(&env), &-9000, &HUM, &WIND, &OBS)
        .unwrap();
    // max valid temp (different timestamp so new record)
    client
        .submit_weather_data(&src, &loc(&env), &6000, &HUM, &WIND, &(OBS + 1))
        .unwrap();
}

#[test]
fn test_different_locations_independent_records() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &src_name(&env))
        .unwrap();
    let loc2 = String::from_str(&env, "Tokyo");
    client
        .submit_weather_data(&src, &loc(&env), &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    client
        .submit_weather_data(&src, &loc2, &TEMP, &HUM, &WIND, &OBS)
        .unwrap();
    assert_eq!(client.get_record_count().unwrap(), 2);
}

#[test]
fn test_multi_oracle_consensus_with_iqr_outlier_trimming() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(3)).unwrap(); // threshold K = 3

    let mut reporters = soroban_sdk::Vec::new(&env);
    for i in 0..5 {
        let src = Address::generate(&env);
        client
            .add_data_source(&admin, &src, &String::from_str(&env, "Station"))
            .unwrap();
        reporters.push_back(src);
    }

    let station_id = 101;
    let epoch = env.ledger().timestamp();

    // 4 legitimate readings: 48, 50, 52, 53 mm
    // 1 corrupted outlier reading: 9999 mm
    let readings = [48, 50, 52, 53, 9999];
    for (i, &val) in readings.iter().enumerate() {
        let rep = reporters.get(i as u32).unwrap();
        client
            .report_weather(&rep, &station_id, &val, &epoch)
            .unwrap();
    }

    let consensus = client.finalize_epoch_consensus(&station_id, &epoch).unwrap();
    assert_eq!(consensus.station_id, station_id);
    assert_eq!(consensus.total_reports, 5);
    // IQR trimming removes the 9999 mm outlier!
    assert!(consensus.valid_reports >= 4);
    assert!(consensus.trimmed_median_rainfall >= 48 && consensus.trimmed_median_rainfall <= 53);
}

#[test]
fn test_network_partition_prevents_premature_consensus() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &Some(4)).unwrap(); // Requires K = 4 reports

    let src1 = Address::generate(&env);
    let src2 = Address::generate(&env);
    client
        .add_data_source(&admin, &src1, &String::from_str(&env, "S1"))
        .unwrap();
    client
        .add_data_source(&admin, &src2, &String::from_str(&env, "S2"))
        .unwrap();

    let station_id = 102;
    let epoch = env.ledger().timestamp();

    // Only 2 of 4 reports arrive due to network partition
    client.report_weather(&src1, &station_id, &45, &epoch).unwrap();
    client.report_weather(&src2, &station_id, &46, &epoch).unwrap();

    let err = client
        .finalize_epoch_consensus(&station_id, &epoch)
        .unwrap_err();
    assert_eq!(err, Error::ConsensusNotReached);
}

#[test]
fn test_stale_weather_data_rejected() {
    let (env, admin, client) = setup();
    client.initialize(&admin, &None).unwrap();
    let src = Address::generate(&env);
    client
        .add_data_source(&admin, &src, &String::from_str(&env, "S1"))
        .unwrap();

    let station_id = 103;
    let stale_epoch = 10; // Very old timestamp

    let err = client
        .report_weather(&src, &station_id, &30, &stale_epoch)
        .unwrap_err();
    assert_eq!(err, Error::StaleData);
}
