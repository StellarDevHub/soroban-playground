// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String};

use crate::types::SeverityLevel;
use crate::{AnalysisUtils, AnalysisUtilsClient, Error, MAX_ONCHAIN_WASM_BYTES};

fn setup() -> (Env, Address, AnalysisUtilsClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register_contract(None, AnalysisUtils);
    let client = AnalysisUtilsClient::new(&env, &id);
    let admin = Address::generate(&env);
    (env, admin, client)
}

fn hash(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_ok() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(client.get_admin(), admin);
    assert!(client.is_initialized());
}

#[test]
fn test_initialize_twice_fails() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_initialize(&admin).unwrap_err().unwrap(),
        Error::AlreadyInitialized
    );
}

// ── security scan ─────────────────────────────────────────────────────────────

#[test]
fn test_record_security_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client
        .try_record_security(&admin, &hash(&env, 1), &SeverityLevel::High, &3)
        .unwrap()
        .unwrap();
    assert_eq!(id, 0);
    assert_eq!(client.get_security_count(), 1);
    let r = client.get_security_report(&0);
    assert_eq!(r.severity, SeverityLevel::High);
    assert_eq!(r.finding_count, 3);
}

#[test]
fn test_multiple_security_reports() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    client
        .try_record_security(&admin, &hash(&env, 1), &SeverityLevel::Low, &1)
        .unwrap();
    client
        .try_record_security(&admin, &hash(&env, 2), &SeverityLevel::Critical, &5)
        .unwrap();
    assert_eq!(client.get_security_count(), 2);
}

#[test]
fn test_security_report_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_security_report(&99).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

#[test]
fn test_non_admin_cannot_record_security() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client
            .try_record_security(&other, &hash(&env, 1), &SeverityLevel::None, &0)
            .unwrap_err()
            .unwrap(),
        Error::Unauthorized
    );
}

// ── gas analysis ──────────────────────────────────────────────────────────────

#[test]
fn test_record_gas_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client
        .try_record_gas(&admin, &hash(&env, 2), &1000u64, &5000u64, &80u32)
        .unwrap()
        .unwrap();
    assert_eq!(id, 0);
    let r = client.get_gas_report(&0);
    assert_eq!(r.avg_gas, 1000);
    assert_eq!(r.max_gas, 5000);
    assert_eq!(r.optimisation_score, 80);
}

#[test]
fn test_gas_score_over_100_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client
            .try_record_gas(&admin, &hash(&env, 2), &100u64, &200u64, &101u32)
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_gas_avg_greater_than_max_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client
            .try_record_gas(&admin, &hash(&env, 2), &9000u64, &1000u64, &50u32)
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_gas_report_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_gas_report(&0).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

// ── code quality ──────────────────────────────────────────────────────────────

#[test]
fn test_record_quality_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client
        .try_record_quality(&admin, &hash(&env, 3), &95u32, &2u32)
        .unwrap()
        .unwrap();
    assert_eq!(id, 0);
    let r = client.get_quality_report(&0);
    assert_eq!(r.score, 95);
    assert_eq!(r.warning_count, 2);
}

#[test]
fn test_quality_score_over_100_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client
            .try_record_quality(&admin, &hash(&env, 3), &101u32, &0u32)
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_quality_report_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_quality_report(&99).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

#[test]
fn test_non_admin_cannot_record_quality() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client
            .try_record_quality(&other, &hash(&env, 3), &90u32, &1u32)
            .unwrap_err()
            .unwrap(),
        Error::Unauthorized
    );
}

// ── property verification ─────────────────────────────────────────────────────

#[test]
fn test_record_verification_ok() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let id = client
        .try_record_verification(&admin, &hash(&env, 4), &s(&env, "no_reentrancy"), &true)
        .unwrap()
        .unwrap();
    assert_eq!(id, 0);
    let r = client.get_verification_result(&0);
    assert!(r.holds);
}

#[test]
fn test_record_verification_failing_property() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    client
        .try_record_verification(&admin, &hash(&env, 4), &s(&env, "balance_monotone"), &false)
        .unwrap();
    let r = client.get_verification_result(&0);
    assert!(!r.holds);
}

#[test]
fn test_record_verification_empty_property_fails() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client
            .try_record_verification(&admin, &hash(&env, 4), &s(&env, ""), &true)
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_verification_result_not_found() {
    let (_env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    assert_eq!(
        client.try_get_verification_result(&0).unwrap_err().unwrap(),
        Error::ReportNotFound
    );
}

#[test]
fn test_non_admin_cannot_record_verification() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();
    let other = Address::generate(&env);
    assert_eq!(
        client
            .try_record_verification(&other, &hash(&env, 4), &s(&env, "prop"), &true)
            .unwrap_err()
            .unwrap(),
        Error::Unauthorized
    );
}

// ── multi-report counts ───────────────────────────────────────────────────────

#[test]
fn test_all_counts_independent() {
    let (env, admin, client) = setup();
    client.try_initialize(&admin).unwrap();

    client
        .try_record_security(&admin, &hash(&env, 1), &SeverityLevel::Info, &0)
        .unwrap();
    client
        .try_record_security(&admin, &hash(&env, 2), &SeverityLevel::Low, &1)
        .unwrap();

    client
        .try_record_gas(&admin, &hash(&env, 3), &500u64, &1000u64, &75u32)
        .unwrap();

    client
        .try_record_quality(&admin, &hash(&env, 4), &88u32, &3u32)
        .unwrap();
    client
        .try_record_quality(&admin, &hash(&env, 5), &72u32, &10u32)
        .unwrap();
    client
        .try_record_quality(&admin, &hash(&env, 6), &55u32, &20u32)
        .unwrap();

    client
        .try_record_verification(&admin, &hash(&env, 7), &s(&env, "safe"), &true)
        .unwrap();

    assert_eq!(client.get_security_count(), 2);
    assert_eq!(client.get_gas_count(), 1);
    assert_eq!(client.get_quality_count(), 3);
    assert_eq!(client.get_verification_count(), 1);
}

// ── pre-init guards ───────────────────────────────────────────────────────────

#[test]
fn test_record_before_init_fails() {
    let (env, admin, client) = setup();
    assert_eq!(
        client
            .try_record_security(&admin, &hash(&env, 0), &SeverityLevel::None, &0)
            .unwrap_err()
            .unwrap(),
        Error::NotInitialized
    );
}

// ── WASM bytecode inspection ──────────────────────────────────────────────────

const WASM_HEADER: [u8; 8] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/// Encodes `value` as unsigned LEB128 into `buf`, returning the byte count.
fn encode_uleb128_into(buf: &mut [u8], value: u32) -> usize {
    let mut v = value;
    let mut n = 0usize;
    loop {
        let mut b = (v & 0x7f) as u8;
        v >>= 7;
        if v != 0 {
            b |= 0x80;
        }
        buf[n] = b;
        n += 1;
        if v == 0 {
            return n;
        }
    }
}

/// Builds a valid multi-section WASM module from `sections` into a fixed
/// stack buffer and returns it as a `Bytes`.
fn test_wasm(env: &Env, sections: &[(u8, &[u8])]) -> Bytes {
    let mut buf = [0u8; 256];
    buf[0..8].copy_from_slice(&WASM_HEADER);
    let mut len = 8usize;
    for (id, payload) in sections {
        buf[len] = *id;
        len += 1;
        len += encode_uleb128_into(&mut buf[len..], payload.len() as u32);
        buf[len..len + payload.len()].copy_from_slice(payload);
        len += payload.len();
    }
    Bytes::from_slice(env, &buf[..len])
}

/// Builds a WASM binary of length `MAX_ONCHAIN_WASM_BYTES + 1` via chunked
/// appends, so no oversized array has to live on the stack. The test env's
/// default allocation budget is reset first so the oversized input can be
/// materialised without tripping the budget.
fn oversized_wasm(env: &Env) -> Bytes {
    env.budget().reset_unlimited();
    let mut wasm = Bytes::new(env);
    let chunk = [0u8; 4096];
    while wasm.len() + chunk.len() as u32 <= MAX_ONCHAIN_WASM_BYTES + 1 {
        wasm.extend_from_slice(&chunk);
    }
    while wasm.len() < MAX_ONCHAIN_WASM_BYTES + 1 {
        wasm.push_back(0);
    }
    wasm
}

#[test]
fn test_inspect_wasm_sections_valid_module() {
    let (env, _admin, client) = setup();
    // Type section (id 1, payload: [0x60, 0x00, 0x00]), Import section
    // (id 2, payload: [0x01]) and Code section (id 10, payload: [0x00, 0x0b]).
    let wasm = test_wasm(
        &env,
        &[(1, &[0x60, 0x00, 0x00]), (2, &[0x01]), (10, &[0x00, 0x0b])],
    );
    let sections = client.try_inspect_wasm_sections(&wasm).unwrap().unwrap();
    assert_eq!(sections.len(), 3);

    let s0 = sections.get(0).unwrap();
    assert_eq!(s0.id, 1);
    assert_eq!(s0.size_bytes, 3);
    assert_eq!(s0.payload_offset, 10);
    assert_eq!(s0.end_offset, 13);

    let s1 = sections.get(1).unwrap();
    assert_eq!(s1.id, 2);
    assert_eq!(s1.size_bytes, 1);
    assert_eq!(s1.payload_offset, 15);
    assert_eq!(s1.end_offset, 16);

    let s2 = sections.get(2).unwrap();
    assert_eq!(s2.id, 10);
    assert_eq!(s2.size_bytes, 2);
    assert_eq!(s2.payload_offset, 18);
    assert_eq!(s2.end_offset, 20);

    // Offset-indexed boundaries: every section starts where the previous one
    // ended (1-byte ID + ULEB128 size prefix + payload).
    assert_eq!(s1.payload_offset, s0.end_offset + 2);
    assert_eq!(s2.payload_offset, s1.end_offset + 2);
}

#[test]
fn test_inspect_wasm_sections_header_only_module() {
    let (env, _admin, client) = setup();
    let wasm = test_wasm(&env, &[]);
    let sections = client.try_inspect_wasm_sections(&wasm).unwrap().unwrap();
    assert_eq!(sections.len(), 0);
}

#[test]
fn test_inspect_wasm_rejects_oversized_input() {
    let (env, _admin, client) = setup();
    let wasm = oversized_wasm(&env);
    assert_eq!(
        client
            .try_inspect_wasm_sections(&wasm)
            .unwrap_err()
            .unwrap(),
        Error::WasmTooLarge
    );
}

// ── malformed WASM inputs ─────────────────────────────────────────────────────

#[test]
fn test_inspect_wasm_rejects_invalid_magic() {
    let (env, _admin, client) = setup();
    let module = [0x00, 0x61, 0x73, 0x6e, 0x01, 0x00, 0x00, 0x00]; // "\0asn"
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_invalid_version() {
    let (env, _admin, client) = setup();
    let module = [0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]; // version 2
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_overlong_uleb128() {
    let (env, _admin, client) = setup();
    // Section ID 1 followed by a varint whose 5th byte still has the
    // continuation bit set: a `u32` LEB128 is at most 5 bytes long.
    let module = [
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // header
        0x01, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00, // id=1, overlong varint
    ];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_uleb128_overflow() {
    let (env, _admin, client) = setup();
    // Section ID 1 followed by a 5-byte varint whose top group carries bits
    // above bit 31: overflows the `u32` length field.
    let module = [
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // header
        0x01, 0x80, 0x80, 0x80, 0x80, 0x10, // id=1, u32-overflowing varint
    ];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_section_length_overflow() {
    let (env, _admin, client) = setup();
    // Section ID 1 followed by a max-value ULEB128 size (`0xFF 0xFF 0xFF
    // 0xFF 0x0F` == 0xFFFFFFFF): adding the payload offset to it overflows
    // `u32`, so the section must be rejected.
    let module = [
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // header
        0x01, 0xff, 0xff, 0xff, 0xff, 0x0f, // id=1, size=u32::MAX
    ];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_section_length_exceeding_module() {
    let (env, _admin, client) = setup();
    // Section ID 1 declares a payload of 10 bytes but the module ends
    // immediately after the size prefix.
    let module = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x0a];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

// ── truncated WASM inputs ─────────────────────────────────────────────────────

#[test]
fn test_inspect_wasm_rejects_empty_input() {
    let (env, _admin, client) = setup();
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &[]))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_truncated_header() {
    let (env, _admin, client) = setup();
    // Fewer than the required 8 bytes.
    let module = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_truncated_mid_header() {
    let (env, _admin, client) = setup();
    // Magic present, version bytes missing.
    let module = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_truncated_mid_uleb128() {
    let (env, _admin, client) = setup();
    // Section ID 1 followed by a ULEB128 continuation byte with no
    // terminator — the varint is cut off.
    let module = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x80];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

#[test]
fn test_inspect_wasm_rejects_truncated_section_payload() {
    let (env, _admin, client) = setup();
    // Section ID 1 declares a payload of 5 bytes but only 1 is present.
    let module = [
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x60,
    ];
    assert_eq!(
        client
            .try_inspect_wasm_sections(&Bytes::from_slice(&env, &module))
            .unwrap_err()
            .unwrap(),
        Error::InvalidInput
    );
}

// ── on-chain SHA-256 hash verification ────────────────────────────────────────

#[test]
fn test_verify_wasm_hash_matching() {
    let (env, _admin, client) = setup();
    let wasm = test_wasm(&env, &[(1, &[0x60, 0x00, 0x00])]);
    let claimed = env.crypto().sha256(&wasm).to_bytes();
    assert!(client
        .try_verify_wasm_hash(&wasm, &claimed)
        .unwrap()
        .unwrap());
}

#[test]
fn test_verify_wasm_hash_mismatched() {
    let (env, _admin, client) = setup();
    let wasm = test_wasm(&env, &[(1, &[0x60, 0x00, 0x00])]);
    let claimed = BytesN::from_array(&env, &[0xab; 32]);
    assert!(!client
        .try_verify_wasm_hash(&wasm, &claimed)
        .unwrap()
        .unwrap());
}

#[test]
fn test_verify_wasm_hash_rejects_oversized() {
    let (env, _admin, client) = setup();
    let wasm = oversized_wasm(&env);
    let claimed = env.crypto().sha256(&wasm).to_bytes();
    assert_eq!(
        client
            .try_verify_wasm_hash(&wasm, &claimed)
            .unwrap_err()
            .unwrap(),
        Error::WasmTooLarge
    );
}
