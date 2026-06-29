// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Carbon Credit Retirement Ledger
//!
//! Tracks environmental impact immutably: verified issuers mint credits,
//! holders transfer or permanently retire them, and every retirement is
//! recorded on-chain as an append-only ledger entry.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_balance, get_issuer_info, get_retirement, get_retirement_count,
    get_total_retired, get_total_supply, is_initialized, save_retirement, set_admin, set_balance,
    set_issuer_info, set_retirement_count, set_total_retired, set_total_supply,
};
use crate::types::{Error, IssuerInfo, RetirementRecord};

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
        info.verified = true;
        set_issuer_info(&env, &issuer, &info);
        env.events()
            .publish((symbol_short!("verified"), issuer), ());
        Ok(())
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

    pub fn retirement_count(env: Env) -> u32 {
        get_retirement_count(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
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
