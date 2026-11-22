// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Carbon Credit Retirement Ledger
//!
//! Tracks environmental impact immutably: verified issuers mint credits,
//! holders transfer or permanently retire them, and every retirement is
//! recorded on-chain as an append-only ledger entry.
//!
//! Retirements additionally mint a **non-transferable retirement certificate**
//! that binds the burned amount to a specific registry project and vintage
//! serial range, co-signed by a verified registry validation oracle. Serial
//! ranges can never be retired twice, which prevents double counting of
//! environmental offsets.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, String};

use crate::storage::{
    get_admin, get_balance, get_certificate, get_certificate_id_by_fingerprint,
    get_certificate_id_by_hash, get_issuer_info, get_retirement, get_retirement_count,
    get_serial_cursor, get_total_retired, get_total_supply, is_initialized, is_oracle,
    save_certificate, save_retirement, set_admin, set_balance, set_certificate_indexes,
    set_issuer_info, set_oracle, set_retirement_count, set_serial_cursor, set_total_retired,
    set_total_supply,
};
use crate::types::{Error, IssuerInfo, RetirementCertificate, RetirementRecord};

#[contract]
pub struct CarbonCreditContract;

#[contractimpl]
impl CarbonCreditContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_total_supply(&env, 0);
        set_total_retired(&env, 0);
        set_retirement_count(&env, 0);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Issuer management ─────────────────────────────────────────────────────

    /// Register as a credit issuer (unverified by default).
    pub fn register_issuer(env: Env, issuer: Address, name: String) -> Result<(), Error> {
        ensure_initialized(&env)?;
        issuer.require_auth();
        if get_issuer_info(&env, &issuer).is_some() {
            return Err(Error::IssuerAlreadyRegistered);
        }
        set_issuer_info(
            &env,
            &issuer,
            &IssuerInfo {
                name,
                verified: false,
                total_minted: 0,
            },
        );
        Ok(())
    }

    /// Admin verifies an issuer, enabling them to mint credits.
    pub fn verify_issuer(env: Env, admin: Address, issuer: Address) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        let mut info = get_issuer_info(&env, &issuer).ok_or(Error::IssuerNotFound)?;
        if info.verified {
            return Err(Error::IssuerAlreadyVerified);
        }
        info.verified = true;
        set_issuer_info(&env, &issuer, &info);
        env.events()
            .publish((symbol_short!("verified"), issuer), ());
        Ok(())
    }

    // ── Registry validation oracles ───────────────────────────────────────────

    /// Admin registers a registry validation oracle that may co-sign
    /// retirement certificates for a given registry.
    pub fn register_oracle(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if is_oracle(&env, &oracle) {
            return Err(Error::OracleAlreadyRegistered);
        }
        set_oracle(&env, &oracle, true);
        env.events()
            .publish((symbol_short!("oracle"), oracle), true);
        Ok(())
    }

    /// Admin revokes a registry validation oracle.
    pub fn revoke_oracle(env: Env, admin: Address, oracle: Address) -> Result<(), Error> {
        assert_admin(&env, &admin)?;
        if !is_oracle(&env, &oracle) {
            return Err(Error::OracleNotFound);
        }
        set_oracle(&env, &oracle, false);
        env.events()
            .publish((symbol_short!("oracle"), oracle), false);
        Ok(())
    }

    pub fn is_oracle(env: Env, oracle: Address) -> bool {
        is_oracle(&env, &oracle)
    }

    // ── Token operations ──────────────────────────────────────────────────────

    /// Verified issuer mints `amount` credits to `to`.
    pub fn mint(env: Env, issuer: Address, to: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        issuer.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let mut info = get_issuer_info(&env, &issuer).ok_or(Error::IssuerNotFound)?;
        if !info.verified {
            return Err(Error::IssuerNotVerified);
        }
        set_balance(&env, &to, get_balance(&env, &to) + amount);
        info.total_minted += amount;
        set_issuer_info(&env, &issuer, &info);
        set_total_supply(&env, get_total_supply(&env) + amount);
        env.events().publish((symbol_short!("mint"), to), amount);
        Ok(())
    }

    /// Transfer `amount` credits from `from` to `to`.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        ensure_initialized(&env)?;
        from.require_auth();
        if from == to {
            return Err(Error::InvalidRecipient);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let from_balance = get_balance(&env, &from);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(&env, &from, from_balance - amount);
        set_balance(&env, &to, get_balance(&env, &to) + amount);
        env.events()
            .publish((symbol_short!("transfer"), from), amount);
        Ok(())
    }

    /// Permanently retire `amount` credits. Creates an immutable ledger entry
    /// referencing `reason_hash` (e.g. an IPFS CID or project reference).
    /// Returns the retirement record ID.
    pub fn retire(
        env: Env,
        retiree: Address,
        amount: i128,
        reason_hash: String,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        retiree.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if reason_hash.is_empty() {
            return Err(Error::InvalidReasonHash);
        }
        let balance = get_balance(&env, &retiree);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(&env, &retiree, balance - amount);
        set_total_supply(&env, get_total_supply(&env) - amount);
        set_total_retired(&env, get_total_retired(&env) + amount);

        let id = get_retirement_count(&env) + 1;
        set_retirement_count(&env, id);
        save_retirement(
            &env,
            &RetirementRecord {
                id,
                retiree: retiree.clone(),
                amount,
                reason_hash,
                retired_at: env.ledger().timestamp(),
            },
        );

        env.events()
            .publish((symbol_short!("retire"), retiree), amount);
        Ok(id)
    }

    /// Retire `amount` credits and mint a non-transferable
    /// [`RetirementCertificate`] bound to a registry project and vintage
    /// serial range.
    ///
    /// Both the `retiree` and a registered registry validation `oracle` must
    /// authorise the call. The serial range must be non-empty, must match
    /// `amount`, and must not overlap any previously retired range for the same
    /// `(registry, project_id, vintage)` triple.
    ///
    /// Returns the new certificate ID.
    #[allow(clippy::too_many_arguments)]
    pub fn retire_with_certificate(
        env: Env,
        retiree: Address,
        oracle: Address,
        registry: String,
        project_id: String,
        vintage: u32,
        serial_start: u64,
        serial_end: u64,
        amount: i128,
        reason_hash: String,
    ) -> Result<u32, Error> {
        ensure_initialized(&env)?;
        retiree.require_auth();
        oracle.require_auth();

        if !is_oracle(&env, &oracle) {
            return Err(Error::OracleNotFound);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if reason_hash.is_empty() {
            return Err(Error::InvalidReasonHash);
        }
        if registry.is_empty() {
            return Err(Error::InvalidRegistry);
        }
        if project_id.is_empty() {
            return Err(Error::InvalidProjectId);
        }
        if vintage == 0 {
            return Err(Error::InvalidVintage);
        }
        if serial_end < serial_start {
            return Err(Error::InvalidSerialRange);
        }
        let serial_count = (serial_end - serial_start) as i128 + 1;
        if serial_count != amount {
            return Err(Error::InvalidSerialRange);
        }

        // Serial ranges are consumed monotonically per project/vintage so a
        // range can never be retired twice (no double counting).
        let cursor_key = serial_cursor_key(&env, &registry, &project_id, vintage);
        let cursor = get_serial_cursor(&env, &cursor_key);
        if serial_start <= cursor {
            return Err(Error::SerialRangeAlreadyRetired);
        }

        let balance = get_balance(&env, &retiree);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let cert_id = get_retirement_count(&env) + 1;
        let retired_at = env.ledger().timestamp();
        let cert_hash = compute_cert_hash(
            &env,
            cert_id,
            &registry,
            &project_id,
            vintage,
            serial_start,
            serial_end,
            amount,
            &retiree,
            &oracle,
        );
        let fingerprint = compute_fingerprint(
            &env,
            &registry,
            &project_id,
            vintage,
            serial_start,
            serial_end,
        );

        // Uniqueness: neither the certificate hash nor the serial range may
        // already be recorded.
        if get_certificate_id_by_hash(&env, &cert_hash).is_some()
            || get_certificate_id_by_fingerprint(&env, &fingerprint).is_some()
        {
            return Err(Error::SerialRangeAlreadyRetired);
        }

        // Burn the fungible balance and record the retirement ledger entry.
        set_balance(&env, &retiree, balance - amount);
        set_total_supply(&env, get_total_supply(&env) - amount);
        set_total_retired(&env, get_total_retired(&env) + amount);
        set_retirement_count(&env, cert_id);
        save_retirement(
            &env,
            &RetirementRecord {
                id: cert_id,
                retiree: retiree.clone(),
                amount,
                reason_hash,
                retired_at,
            },
        );

        let cert = RetirementCertificate {
            cert_id,
            registry,
            project_id,
            vintage,
            serial_start,
            serial_end,
            amount,
            retiree: retiree.clone(),
            oracle: oracle.clone(),
            cert_hash: cert_hash.clone(),
            retired_at,
        };
        save_certificate(&env, &cert);
        set_certificate_indexes(&env, &cert, &fingerprint);
        set_serial_cursor(&env, &cursor_key, serial_end);

        env.events().publish(
            (symbol_short!("cert"), retiree),
            (
                cert_id,
                cert_hash,
                cert.registry.clone(),
                cert.project_id.clone(),
                vintage,
                serial_start,
                serial_end,
                amount,
                oracle,
            ),
        );
        Ok(cert_id)
    }

    // ── Read-only queries ─────────────────────────────────────────────────────

    pub fn get_balance(env: Env, user: Address) -> i128 {
        get_balance(&env, &user)
    }

    pub fn get_issuer_info(env: Env, issuer: Address) -> Result<IssuerInfo, Error> {
        get_issuer_info(&env, &issuer).ok_or(Error::IssuerNotFound)
    }

    pub fn total_supply(env: Env) -> i128 {
        get_total_supply(&env)
    }

    pub fn total_retired(env: Env) -> i128 {
        get_total_retired(&env)
    }

    pub fn get_retirement(env: Env, id: u32) -> Result<RetirementRecord, Error> {
        get_retirement(&env, id)
    }

    pub fn is_retired(env: Env, id: u32) -> bool {
        get_retirement(&env, id).is_ok()
    }

    pub fn retirement_count(env: Env) -> u32 {
        get_retirement_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Fetch a retirement certificate by ID.
    pub fn get_certificate(env: Env, cert_id: u32) -> Result<RetirementCertificate, Error> {
        get_certificate(&env, cert_id)
    }

    /// Fetch a retirement certificate by its content hash.
    pub fn get_certificate_by_hash(
        env: Env,
        cert_hash: BytesN<32>,
    ) -> Result<RetirementCertificate, Error> {
        let cert_id =
            get_certificate_id_by_hash(&env, &cert_hash).ok_or(Error::CertificateNotFound)?;
        get_certificate(&env, cert_id)
    }

    /// Returns the highest serial number already retired for a project vintage.
    pub fn retired_serial_cursor(
        env: Env,
        registry: String,
        project_id: String,
        vintage: u32,
    ) -> u64 {
        let key = serial_cursor_key(&env, &registry, &project_id, vintage);
        get_serial_cursor(&env, &key)
    }
}

fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        Err(Error::NotInitialized)
    } else {
        Ok(())
    }
}

fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    ensure_initialized(env)?;
    caller.require_auth();
    let admin = get_admin(env)?;
    if *caller != admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

/// Build the storage key for the serial cursor of a project vintage.
fn serial_cursor_key(
    env: &Env,
    registry: &String,
    project_id: &String,
    vintage: u32,
) -> BytesN<32> {
    let mut raw = Bytes::new(env);
    append_string(env, &mut raw, registry);
    raw.push_back(0u8);
    append_string(env, &mut raw, project_id);
    raw.push_back(0u8);
    for b in vintage.to_be_bytes() {
        raw.push_back(b);
    }
    env.crypto().sha256(&raw).into()
}

/// Deterministic fingerprint of a retired serial range.
fn compute_fingerprint(
    env: &Env,
    registry: &String,
    project_id: &String,
    vintage: u32,
    serial_start: u64,
    serial_end: u64,
) -> BytesN<32> {
    let mut raw = Bytes::new(env);
    append_string(env, &mut raw, registry);
    raw.push_back(0u8);
    append_string(env, &mut raw, project_id);
    raw.push_back(0u8);
    for b in vintage.to_be_bytes() {
        raw.push_back(b);
    }
    for b in serial_start.to_be_bytes() {
        raw.push_back(b);
    }
    for b in serial_end.to_be_bytes() {
        raw.push_back(b);
    }
    env.crypto().sha256(&raw).into()
}

/// Deterministic certificate hash over every certificate field.
#[allow(clippy::too_many_arguments)]
fn compute_cert_hash(
    env: &Env,
    cert_id: u32,
    registry: &String,
    project_id: &String,
    vintage: u32,
    serial_start: u64,
    serial_end: u64,
    amount: i128,
    retiree: &Address,
    oracle: &Address,
) -> BytesN<32> {
    let mut raw = Bytes::new(env);
    for b in cert_id.to_be_bytes() {
        raw.push_back(b);
    }
    append_string(env, &mut raw, registry);
    raw.push_back(0u8);
    append_string(env, &mut raw, project_id);
    raw.push_back(0u8);
    for b in vintage.to_be_bytes() {
        raw.push_back(b);
    }
    for b in serial_start.to_be_bytes() {
        raw.push_back(b);
    }
    for b in serial_end.to_be_bytes() {
        raw.push_back(b);
    }
    for b in amount.to_be_bytes() {
        raw.push_back(b);
    }
    append_address(env, &mut raw, retiree);
    append_address(env, &mut raw, oracle);
    env.crypto().sha256(&raw).into()
}

/// Appends `value` to `raw` as XDR. The XDR encoding is length-prefixed, so
/// adjacent fields cannot run together and produce colliding hashes.
fn append_string(env: &Env, raw: &mut Bytes, value: &String) {
    raw.append(&value.clone().to_xdr(env));
}

fn append_address(env: &Env, raw: &mut Bytes, address: &Address) {
    raw.append(&address.clone().to_xdr(env));
}
