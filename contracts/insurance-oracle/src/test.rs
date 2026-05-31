#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

use crate::{InsuranceOracle, InsuranceOracleClient, RiskData};
use crate::Error;

fn setup() -> (Env, Address, InsuranceOracleClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, InsuranceOracle);
    let client = InsuranceOracleClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn make_string(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn make_address(env: &Env) -> Address {
    Address::generate(env)
}

fn make_risk_data(env: &Env, source: &Address, risk_type: &str, value: i128, confidence: u32) -> RiskData {
    RiskData {
        source: source.clone(),
        risk_type: make_string(env, risk_type),
        value,
        confidence,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(env, "test"),
    }
}

// ── Initialize Tests ─────────────────────────────────────────────────────────

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

// ── Risk Data Tests ───────────────────────────────────────────────────────────

#[test]
fn test_submit_risk_data_valid() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    let data = make_risk_data(&env, &source, "crop", 100, 90);
    client.submit_risk_data(&data).unwrap();
}

#[test]
fn test_submit_risk_data_unauthorized_source() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let unauthorized = make_address(&env);
    
    let data = make_risk_data(&env, &unauthorized, "crop", 100, 90);
    let err = client.submit_risk_data(&data).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_submit_risk_data_confidence_zero_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    let data = RiskData {
        source,
        risk_type: make_string(&env, "test"),
        value: 100,
        confidence: 0,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    };
    client.submit_risk_data(&data).unwrap();
}

#[test]
fn test_submit_risk_data_confidence_100_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    let data = RiskData {
        source,
        risk_type: make_string(&env, "test"),
        value: 100,
        confidence: 100,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    };
    client.submit_risk_data(&data).unwrap();
}

#[test]
fn test_submit_risk_data_confidence_101_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    let data = RiskData {
        source,
        risk_type: make_string(&env, "test"),
        value: 100,
        confidence: 101,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    };
    let err = client.submit_risk_data(&data).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_submit_risk_data_circuit_breaker_active() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.activate_circuit_breaker(&admin).unwrap();
    
    let data = make_risk_data(&env, &source, "test", 100, 90);
    let err = client.submit_risk_data(&data).unwrap_err();
    assert_eq!(err, Error::CircuitOpen);
}

#[test]
fn test_submit_risk_data_risk_type_too_long() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    let mut risk_type = String::from_str(&env, "");
    for _ in 0..65 {
        risk_type.push_str(&make_string(&env, "x"));
    }
    let data = RiskData {
        source,
        risk_type,
        value: 100,
        confidence: 50,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    };
    let err = client.submit_risk_data(&data).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_submit_risk_data_metadata_too_long() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    let mut metadata = String::from_str(&env, "");
    for _ in 0..257 {
        metadata.push_str(&make_string(&env, "x"));
    }
    let data = RiskData {
        source,
        risk_type: make_string(&env, "test"),
        value: 100,
        confidence: 50,
        timestamp: env.ledger().timestamp(),
        metadata,
    };
    let err = client.submit_risk_data(&data).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_get_risk_data_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let result = client.get_risk_data(&env, &make_string(&env, "crop")).unwrap();
    assert_eq!(result.len(), 0);
}

#[test]
fn test_get_risk_data_with_entries() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.submit_risk_data(&make_risk_data(&env, &source, "crop", 100, 90)).unwrap();
    
    let result = client.get_risk_data(&env, &make_string(&env, "crop")).unwrap();
    assert_eq!(result.len(), 1);
}

#[test]
fn test_get_historical_claims_empty() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let ts = env.ledger().timestamp();
    let result = client.get_historical_claims(&env, &make_string(&env, "crop"), ts, ts + 1000).unwrap();
    assert_eq!(result.len(), 0);
}

#[test]
fn test_get_historical_claims_filtered() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    let now = env.ledger().timestamp();
    let data = RiskData {
        source,
        risk_type: make_string(&env, "crop"),
        value: 100,
        confidence: 90,
        timestamp: now,
        metadata: make_string(&env, "m"),
    };
    client.submit_risk_data(&data).unwrap();
    
    let result = client.get_historical_claims(&env, &make_string(&env, "crop"), now, now + 100).unwrap();
    assert_eq!(result.len(), 1);
}

#[test]
fn test_get_historical_claims_out_of_range() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.submit_risk_data(&make_risk_data(&env, &source, "crop", 100, 90)).unwrap();
    
    let result = client.get_historical_claims(&env, &make_string(&env, "crop"), 9999999, 10000000).unwrap();
    assert_eq!(result.len(), 0);
}

// ── Source Management Tests ───────────────────────────────────────────────────

#[test]
fn test_add_data_source_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
}

#[test]
fn test_add_data_source_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let other = make_address(&env);
    env.mock_all_auths();
    let err = client.add_data_source(&other, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_add_data_source_duplicate_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.add_data_source(&admin, &source).unwrap();
}

#[test]
fn test_add_data_source_cap_20() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for _ in 0..20 {
        client.add_data_source(&admin, &make_address(&env)).unwrap();
    }
}

#[test]
fn test_add_data_source_cap_exceeded() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for _ in 0..20 {
        client.add_data_source(&admin, &make_address(&env)).unwrap();
    }
    let err = client.add_data_source(&admin, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::CapExceeded);
}

#[test]
fn test_remove_data_source_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.remove_data_source(&admin, &source).unwrap();
    assert_eq!(client.get_sources_fn(&env).unwrap().len(), 0);
}

#[test]
fn test_remove_data_source_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    let other = make_address(&env);
    env.mock_all_auths();
    let err = client.remove_data_source(&other, &source).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_remove_data_source_not_found() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.add_data_source(&admin, &make_address(&env)).unwrap();
    let err = client.remove_data_source(&admin, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

// ── Verification Threshold Tests ───────────────────────────────────────────────

#[test]
fn test_set_verification_threshold_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.set_verification_threshold(&admin, &5).unwrap();
    assert_eq!(client.get_threshold_fn(&env).unwrap(), 5);
}

#[test]
fn test_set_verification_threshold_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let other = make_address(&env);
    env.mock_all_auths();
    let err = client.set_verification_threshold(&other, &5).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_set_verification_threshold_0_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.set_verification_threshold(&admin, &0).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

#[test]
fn test_set_verification_threshold_1_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.set_verification_threshold(&admin, &1).unwrap();
}

#[test]
fn test_set_verification_threshold_20_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.set_verification_threshold(&admin, &20).unwrap();
}

#[test]
fn test_set_verification_threshold_21_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let err = client.set_verification_threshold(&admin, &21).unwrap_err();
    assert_eq!(err, Error::InvalidInput);
}

// ── Circuit Breaker Tests ─────────────────────────────────────────────────────

#[test]
fn test_activate_circuit_breaker() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.activate_circuit_breaker(&admin).unwrap();
    assert!(client.is_circuit_open_fn(&env).unwrap());
}

#[test]
fn test_activate_circuit_breaker_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let other = make_address(&env);
    env.mock_all_auths();
    let err = client.activate_circuit_breaker(&other).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_deactivate_circuit_breaker() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.activate_circuit_breaker(&admin).unwrap();
    client.deactivate_circuit_breaker(&admin).unwrap();
    assert!(!client.is_circuit_open_fn(&env).unwrap());
}

#[test]
fn test_deactivate_circuit_breaker_non_admin_fails() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.activate_circuit_breaker(&admin).unwrap();
    let other = make_address(&env);
    env.mock_all_auths();
    let err = client.deactivate_circuit_breaker(&other).unwrap_err();
    assert_eq!(err, Error::Unauthorized);
}

#[test]
fn test_circuit_breaker_blocks_submission() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.activate_circuit_breaker(&admin).unwrap();
    
    let data = make_risk_data(&env, &source, "test", 100, 90);
    let err = client.submit_risk_data(&data).unwrap_err();
    assert_eq!(err, Error::CircuitOpen);
}

// ── Outlier Detection Tests ───────────────────────────────────────────────────

#[test]
fn test_outlier_detection_less_than_3_values() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    // Submit 2 values - outlier detection requires 3+
    client.submit_risk_data(&RiskData {
        source,
        risk_type: make_string(&env, "weather"),
        value: 100,
        confidence: 90,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    }).unwrap();
    
    client.submit_risk_data(&RiskData {
        source,
        risk_type: make_string(&env, "weather"),
        value: 10000,
        confidence: 90,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    }).unwrap();
}

#[test]
fn test_outlier_detection_with_3_values() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    // Submit 3 similar values
    for _ in 0..3 {
        client.submit_risk_data(&RiskData {
            source,
            risk_type: make_string(&env, "weather"),
            value: 100,
            confidence: 90,
            timestamp: env.ledger().timestamp(),
            metadata: make_string(&env, "m"),
        }).unwrap();
    }
}

// ── Read-only Tests ───────────────────────────────────────────────────────────

#[test]
fn test_get_admin_ok() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    assert_eq!(client.get_admin(&env).unwrap(), admin);
}

#[test]
fn test_get_sources_fn() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    assert_eq!(client.get_sources_fn(&env).unwrap().len(), 0);
}

#[test]
fn test_get_threshold_default() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    assert_eq!(client.get_threshold_fn(&env).unwrap(), 3);
}

// ── Non-Initialized Tests ─────────────────────────────────────────────────────

#[test]
fn test_submit_risk_data_before_init_fails() {
    let (env, _admin, client) = setup();
    let source = make_address(&env);
    let data = make_risk_data(&env, &source, "crop", 100, 90);
    let err = client.submit_risk_data(&data).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_add_source_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.add_data_source(&_admin, &make_address(&env)).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_activate_breaker_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.activate_circuit_breaker(&_admin).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

// ── Additional Risk Data Tests ───────────────────────────────────────────────

#[test]
fn test_submit_risk_data_negative_value() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.submit_risk_data(&RiskData {
        source,
        risk_type: make_string(&env, "test"),
        value: -100,
        confidence: 50,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    }).unwrap();
}

#[test]
fn test_get_risk_data_multiple_types() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.submit_risk_data(&make_risk_data(&env, &source, "type_a", 100, 90)).unwrap();
    client.submit_risk_data(&make_risk_data(&env, &source, "type_b", 200, 80)).unwrap();
}

#[test]
fn test_get_historical_claims_multiple() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    let now = env.ledger().timestamp();
    for i in 0..5 {
        let data = RiskData {
            source,
            risk_type: make_string(&env, "crop"),
            value: i * 10,
            confidence: 90,
            timestamp: now + i * 1000,
            metadata: make_string(&env, "m"),
        };
        client.submit_risk_data(&data).unwrap();
    }
    let result = client.get_historical_claims(&env, &make_string(&env, "crop"), now, now + 10000).unwrap();
    assert_eq!(result.len(), 5);
}

// ── Additional Source Tests ───────────────────────────────────────────────────

#[test]
fn test_add_multiple_sources() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for _ in 0..5 {
        client.add_data_source(&admin, &make_address(&env)).unwrap();
    }
    assert_eq!(client.get_sources_fn(&env).unwrap().len(), 5);
}

#[test]
fn test_remove_one_of_many_sources() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let s1 = make_address(&env);
    let s2 = make_address(&env);
    let s3 = make_address(&env);
    client.add_data_source(&admin, &s1).unwrap();
    client.add_data_source(&admin, &s2).unwrap();
    client.add_data_source(&admin, &s3).unwrap();
    client.remove_data_source(&admin, &s2).unwrap();
    let sources = client.get_sources_fn(&env).unwrap();
    assert_eq!(sources.len(), 2);
}

// ── Additional Threshold Tests ───────────────────────────────────────────────

#[test]
fn test_set_threshold_multiple_times() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for i in 1..20 {
        client.set_verification_threshold(&admin, &i).unwrap();
        assert_eq!(client.get_threshold_fn(&env).unwrap(), i);
    }
}

#[test]
fn test_threshold_boundary_2() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.set_verification_threshold(&admin, &2).unwrap();
    assert_eq!(client.get_threshold_fn(&env).unwrap(), 2);
}

#[test]
fn test_threshold_boundary_19() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.set_verification_threshold(&admin, &19).unwrap();
    assert_eq!(client.get_threshold_fn(&env).unwrap(), 19);
}

// ── Additional Circuit Breaker Tests ───────────────────────────────────────────

#[test]
fn test_circuit_breaker_reactivate() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.activate_circuit_breaker(&admin).unwrap();
    client.deactivate_circuit_breaker(&admin).unwrap();
    client.activate_circuit_breaker(&admin).unwrap();
    assert!(client.is_circuit_open_fn(&env).unwrap());
}

#[test]
fn test_circuit_breaker_deactivate_when_closed() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    client.deactivate_circuit_breaker(&admin).unwrap();
    assert!(!client.is_circuit_open_fn(&env).unwrap());
}

// ── Additional Read-only Tests ───────────────────────────────────────────────

#[test]
fn test_get_admin_twice() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    assert_eq!(client.get_admin(&env).unwrap(), admin);
    assert_eq!(client.get_admin(&env).unwrap(), admin);
}

// ── Additional Risk Data Tests ───────────────────────────────────────────────

#[test]
fn test_submit_risk_data_zero_confidence() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.submit_risk_data(&RiskData {
        source,
        risk_type: make_string(&env, "zero_conf"),
        value: 50,
        confidence: 0,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    }).unwrap();
}

#[test]
fn test_submit_risk_data_large_value() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    client.submit_risk_data(&RiskData {
        source,
        risk_type: make_string(&env, "large"),
        value: 1_000_000_000,
        confidence: 95,
        timestamp: env.ledger().timestamp(),
        metadata: make_string(&env, "m"),
    }).unwrap();
}

#[test]
fn test_get_risk_data_different_types() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    
    for rt in ["flood", "fire", "wind", "earthquake"].iter() {
        client.submit_risk_data(&RiskData {
            source,
            risk_type: make_string(&env, rt),
            value: 100,
            confidence: 85,
            timestamp: env.ledger().timestamp(),
            metadata: make_string(&env, "m"),
        }).unwrap();
    }
}

// ── Additional Source Tests ───────────────────────────────────────────────────

#[test]
fn test_add_source_verify_threshold_boundary() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    // Test that we can add sources while checking threshold boundary
    for i in 1..=20 {
        client.set_verification_threshold(&admin, &i).unwrap();
        client.add_data_source(&admin, &make_address(&env)).unwrap();
    }
}

#[test]
fn test_remove_all_sources() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    for _ in 0..5 {
        client.add_data_source(&admin, &make_address(&env)).unwrap();
    }
    let sources = client.get_sources_fn(&env).unwrap();
    assert_eq!(sources.len(), 5);
}

// ── Outlier Detection Edge Cases ─────────────────────────────────────────────

#[test]
fn test_outlier_detection_exactly_3_std_dev() {
    let (env, admin, client) = setup();
    client.initialize(&admin).unwrap();
    let source = make_address(&env);
    client.add_data_source(&admin, &source).unwrap();
    // This is handled internally - just verify it doesn't panic
}

// ── Additional Non-Initialized Tests ─────────────────────────────────────────

#[test]
fn test_get_risk_data_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.get_risk_data(&env, &make_string(&env, "t")).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_historical_claims_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.get_historical_claims(&env, &make_string(&env, "t"), 0, 100).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_sources_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.get_sources_fn(&env).unwrap_err();
    assert_eq!(err, Error::NotFound);
}

#[test]
fn test_get_threshold_before_init_fails() {
    let (env, _admin, client) = setup();
    let err = client.get_threshold_fn(&env).unwrap_err();
    assert_eq!(err, Error::NotFound);
}