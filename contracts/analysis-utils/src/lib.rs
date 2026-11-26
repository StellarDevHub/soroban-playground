// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Analysis Utils Contract  (Issue #595)
//!
//! Provides on-chain storage of contract analysis results produced by off-chain
//! tooling (static analysers, gas estimators, formal verifiers).  The contract
//! acts as an immutable, admin-gated audit ledger for four analysis types:
//!
//! * **Security scan** — vulnerability severity and finding count.
//! * **Gas analysis** — average / worst-case gas usage and optimisation score.
//! * **Code quality** — overall score and warning count.
//! * **Property verification** — whether a named property holds.
//!
//! Off-chain tools submit results; any consumer can read them permissionlessly.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, Address, Bytes, BytesN, Env, String, Vec,
};

use crate::storage::{
    get_admin, get_gas_count, get_quality_count, get_security_count, get_verify_count,
    is_initialized, load_gas, load_quality, load_security, load_verify, set_admin, set_gas_count,
    set_quality_count, set_security_count, set_verify_count, store_gas, store_quality,
    store_security, store_verify,
};
use crate::types::{
    GasReport, QualityReport, SecurityReport, SeverityLevel, VerificationResult, WasmSectionSummary,
};

/// Errors returned by the analysis-utils contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    ReportNotFound = 4,
    InvalidInput = 5,
    WasmTooLarge = 6,
}

#[contract]
pub struct AnalysisUtils;

#[contractimpl]
impl AnalysisUtils {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Security scan ─────────────────────────────────────────────────────────

    /// Record a security scan result. Admin only. Returns report ID.
    pub fn record_security(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        severity: SeverityLevel,
        finding_count: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;

        let id = get_security_count(&env);
        let report = SecurityReport {
            id,
            contract_hash,
            severity,
            finding_count,
            scanned_at: env.ledger().timestamp(),
        };
        store_security(&env, &report);
        set_security_count(&env, id + 1);
        env.events().publish(
            (symbol_short!("sec"),),
            (id, severity as u32, finding_count),
        );
        Ok(id)
    }

    pub fn get_security_report(env: Env, id: u32) -> Result<SecurityReport, Error> {
        ensure_initialized(&env)?;
        load_security(&env, id)
    }

    pub fn get_security_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_security_count(&env))
    }

    // ── Gas analysis ──────────────────────────────────────────────────────────

    /// Record a gas analysis result. Admin only. Returns report ID.
    pub fn record_gas(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        avg_gas: u64,
        max_gas: u64,
        optimisation_score: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if optimisation_score > 100 {
            return Err(Error::InvalidInput);
        }
        if avg_gas > max_gas {
            return Err(Error::InvalidInput);
        }

        let id = get_gas_count(&env);
        let report = GasReport {
            id,
            contract_hash,
            avg_gas,
            max_gas,
            optimisation_score,
            analysed_at: env.ledger().timestamp(),
        };
        store_gas(&env, &report);
        set_gas_count(&env, id + 1);
        env.events()
            .publish((symbol_short!("gas"),), (id, avg_gas, optimisation_score));
        Ok(id)
    }

    pub fn get_gas_report(env: Env, id: u32) -> Result<GasReport, Error> {
        ensure_initialized(&env)?;
        load_gas(&env, id)
    }

    pub fn get_gas_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_gas_count(&env))
    }

    // ── Code quality ──────────────────────────────────────────────────────────

    /// Record a code-quality check result. Admin only. Returns report ID.
    pub fn record_quality(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        score: u32,
        warning_count: u32,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if score > 100 {
            return Err(Error::InvalidInput);
        }

        let id = get_quality_count(&env);
        let report = QualityReport {
            id,
            contract_hash,
            score,
            warning_count,
            checked_at: env.ledger().timestamp(),
        };
        store_quality(&env, &report);
        set_quality_count(&env, id + 1);
        env.events()
            .publish((symbol_short!("qual"),), (id, score, warning_count));
        Ok(id)
    }

    pub fn get_quality_report(env: Env, id: u32) -> Result<QualityReport, Error> {
        ensure_initialized(&env)?;
        load_quality(&env, id)
    }

    pub fn get_quality_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_quality_count(&env))
    }

    // ── Property verification ─────────────────────────────────────────────────

    /// Record a formal-property verification result. Admin only. Returns result ID.
    pub fn record_verification(
        env: Env,
        admin: Address,
        contract_hash: BytesN<32>,
        property: String,
        holds: bool,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        admin.require_auth();
        require_admin(&env, &admin)?;
        if property.is_empty() {
            return Err(Error::InvalidInput);
        }

        let id = get_verify_count(&env);
        let result = VerificationResult {
            id,
            contract_hash,
            property,
            holds,
            verified_at: env.ledger().timestamp(),
        };
        store_verify(&env, &result);
        set_verify_count(&env, id + 1);
        env.events()
            .publish((symbol_short!("verify"),), (id, holds));
        Ok(id)
    }

    pub fn get_verification_result(env: Env, id: u32) -> Result<VerificationResult, Error> {
        ensure_initialized(&env)?;
        load_verify(&env, id)
    }

    pub fn get_verification_count(env: Env) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        Ok(get_verify_count(&env))
    }

    // ── WASM bytecode inspection ───────────────────────────────────────────────

    /// Inspects a WASM module header and its section table via a chunked,
    /// offset-indexed parser: the 8-byte header is validated with a fixed
    /// stack buffer and each section is read as a 1-byte ID + ULEB128 size
    /// prefix — the module binary itself is never copied into guest memory.
    ///
    /// Inputs larger than `MAX_ONCHAIN_WASM_BYTES` are rejected with
    /// `Error::WasmTooLarge` before any parsing, so adversarial bytecode can
    /// never trigger out-of-memory panics. Malformed or truncated modules
    /// yield `Error::InvalidInput`.
    pub fn inspect_wasm_sections(env: Env, wasm: Bytes) -> Result<Vec<WasmSectionSummary>, Error> {
        enforce_wasm_size_bound(&wasm)?;
        parse_wasm_sections(&env, &wasm)
    }

    /// Verifies a submitted analysis report's cryptographic commitment
    /// (`claimed_hash`, a `BytesN<32>` SHA-256 hash) against the target WASM
    /// bytes: the SHA-256 is re-derived on-chain with
    /// `env.crypto().sha256(...)`. Also enforces the strict on-chain size
    /// bound and structural validation of the module. Returns `Ok(true)` when
    /// the claim matches, `Ok(false)` when it does not.
    pub fn verify_wasm_hash(
        env: Env,
        wasm: Bytes,
        claimed_hash: BytesN<32>,
    ) -> Result<bool, Error> {
        enforce_wasm_size_bound(&wasm)?;
        parse_wasm_sections(&env, &wasm)?;
        let actual_hash = env.crypto().sha256(&wasm).to_bytes();
        Ok(actual_hash == claimed_hash)
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }
}

// ── WASM bytecode inspection: constants & parsers ─────────────────────────────

/// Magic bytes of the WASM binary format: `\0asm`.
const WASM_MAGIC: [u8; 4] = [0x00, 0x61, 0x73, 0x6d];

/// The only binary version this contract accepts: `01 00 00 00`.
const WASM_VERSION: [u8; 4] = [0x01, 0x00, 0x00, 0x00];

/// Strict on-chain input bound for WASM binaries (1 MiB). This is well
/// below the Soroban linear-memory ceiling of 65536 pages (4 GiB) while
/// still bounding guest-memory usage during inspection.
pub const MAX_ONCHAIN_WASM_BYTES: u32 = 1_048_576;

/// Rejects inputs larger than `MAX_ONCHAIN_WASM_BYTES` with
/// `Error::WasmTooLarge` before anything is allocated or copied.
fn enforce_wasm_size_bound(wasm: &Bytes) -> Result<(), Error> {
    if wasm.len() > MAX_ONCHAIN_WASM_BYTES {
        return Err(Error::WasmTooLarge);
    }
    Ok(())
}

/// Validates the 8-byte WASM binary header (`\0asm` + version `01 00 00 00`)
/// using small fixed stack buffers, without allocating or copying anything.
fn parse_wasm_header(wasm: &Bytes) -> Result<(), Error> {
    if wasm.len() < 8 {
        return Err(Error::InvalidInput);
    }
    for i in 0..4u32 {
        if wasm.get(i).ok_or(Error::InvalidInput)? != WASM_MAGIC[i as usize] {
            return Err(Error::InvalidInput);
        }
    }
    for i in 0..4u32 {
        if wasm.get(4 + i).ok_or(Error::InvalidInput)? != WASM_VERSION[i as usize] {
            return Err(Error::InvalidInput);
        }
    }
    Ok(())
}

/// Reads an unsigned LEB128 varint of at most 5 bytes at `offset` (a `u32`
/// LEB128 is at most 5 bytes long: 4 full 7-bit groups plus the top 4 bits of
/// the 5th group). Returns `(value, offset_of_first_byte_after_the_varint)`.
///
/// Every read is bounds-checked and every length calculation uses checked
/// arithmetic, so adversarial input can only produce `Err`, never a panic or
/// an overflowing length:
///  * truncation  — the varint ends past the end of the module → `Err`
///  * overlong    — a 6th byte exists or the 5th byte has continuation bits → `Err`
///  * u32 overflow — the 5th byte holds bits above bit 31 → `Err`
fn read_uleb128(wasm: &Bytes, offset: u32) -> Result<(u32, u32), Error> {
    let mut value: u32 = 0;
    let mut shift: u32 = 0;
    let mut cursor = offset;
    loop {
        if cursor >= wasm.len() {
            return Err(Error::InvalidInput);
        }
        let byte = wasm.get(cursor).ok_or(Error::InvalidInput)?;
        cursor = cursor.checked_add(1).ok_or(Error::InvalidInput)?;
        if shift >= 28 {
            // 5th byte: `u32` only has 4 bits left in the top group. A
            // continuation bit, or any of the top 3 bits set, means the
            // encoding is overlong or overflows the `u32` length field.
            if byte & 0x80 != 0 || byte & 0x70 != 0 {
                return Err(Error::InvalidInput);
            }
            value |= (byte as u32) << 28;
            return Ok((value, cursor));
        }
        value |= ((byte & 0x7f) as u32) << shift;
        if byte & 0x80 == 0 {
            return Ok((value, cursor));
        }
        shift += 7;
    }
}

/// Streams the section table of a WASM module with the chunked, offset-indexed
/// walker: reads only the 1-byte section ID and the ULEB128 size prefix of
/// each section, then jumps `offset = section_end` with checked arithmetic.
///
/// Invariants enforced for every section:
///  * `offset` always lands on a section boundary and never exceeds
///    `wasm.len()` (`section_end > wasm.len()` → `Err(InvalidInput)`);
///  * `section_end` is computed with `checked_add` (offset + size cannot
///    overflow `u32`);
///  * offsets are read with `Bytes::get`, which returns `None` instead of
///    panicking when past the end of the module.
fn parse_wasm_sections(env: &Env, wasm: &Bytes) -> Result<Vec<WasmSectionSummary>, Error> {
    parse_wasm_header(wasm)?;
    let mut offset: u32 = 8;
    let mut sections = Vec::new(env);
    while offset < wasm.len() {
        // 1-byte section ID.
        let section_id = wasm.get(offset).ok_or(Error::InvalidInput)?;
        // ULEB128 section size (max 5 bytes for `u32`); the payload starts
        // right after the size prefix.
        let (section_size, payload_offset) =
            read_uleb128(wasm, offset.checked_add(1).ok_or(Error::InvalidInput)?)?;
        // Checked arithmetic + bounds check: the section must land cleanly
        // inside the module.
        let section_end = payload_offset
            .checked_add(section_size)
            .ok_or(Error::InvalidInput)?;
        if section_end > wasm.len() {
            return Err(Error::InvalidInput);
        }
        sections.push_back(WasmSectionSummary {
            id: section_id as u32,
            size_bytes: section_size,
            payload_offset,
            end_offset: section_end,
        });
        offset = section_end;
    }
    Ok(sections)
}

// ── Private helpers ───────────────────────────────────────────────────────────

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    if get_admin(env)? != *caller {
        return Err(Error::Unauthorized);
    }
    Ok(())
}
