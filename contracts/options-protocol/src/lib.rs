// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Options Protocol
//!
//! On-chain call/put options: a writer locks collateral, a holder pays a
//! premium, and can exercise before expiry.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_option, get_option_count, is_initialized, is_paused, set_admin, set_option,
    set_option_count, set_paused,
};
use crate::types::{Error, OptionContract, OptionKind, OptionStatus};

#[contract]
pub struct OptionsProtocol;

#[contractimpl]
impl OptionsProtocol {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_option_count(&env, 0);
        set_paused(&env, false);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn set_paused(env: Env, admin: Address, paused: bool) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, paused);
        env.events().publish((symbol_short!("paused"),), paused);
        Ok(())
    }

    // ── Writer actions ────────────────────────────────────────────────────────

    /// Write a new option and assign it to `holder`.
    /// Returns the option ID.
    pub fn write_option(
        env: Env,
        writer: Address,
        holder: Address,
        underlying: String,
        strike_price: i128,
        premium: i128,
        amount: i128,
        expiry: u64,
        kind: OptionKind,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized_guard(&env)?;
        writer.require_auth();

        if writer == holder {
            return Err(Error::WriterCannotBeHolder);
        }
        if strike_price <= 0 {
            return Err(Error::InvalidStrike);
        }
        if premium < 0 {
            return Err(Error::InvalidPremium);
        }
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if expiry <= env.ledger().timestamp() {
            return Err(Error::InvalidExpiry);
        }

        let id = get_option_count(&env) + 1;
        let option = OptionContract {
            id,
            writer: writer.clone(),
            holder: holder.clone(),
            underlying,
            strike_price,
            premium,
            amount,
            expiry,
            kind,
            status: OptionStatus::Active,
        };

        set_option(&env, &option);
        set_option_count(&env, id);

        env.events()
            .publish((symbol_short!("written"), id), (writer, holder));
        Ok(id)
    }

    /// Cancel an active option (writer only, before expiry).
    pub fn cancel_option(env: Env, writer: Address, option_id: u32) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;
        writer.require_auth();

        let mut option = get_option(&env, option_id)?;
        if option.writer != writer {
            return Err(Error::Unauthorized);
        }
        if option.status != OptionStatus::Active {
            return Err(Error::OptionNotActive);
        }

        option.status = OptionStatus::Cancelled;
        set_option(&env, &option);

        env.events()
            .publish((symbol_short!("cancelled"), option_id), writer);
        Ok(())
    }

    // ── Holder actions ────────────────────────────────────────────────────────

    /// Exercise an active option before expiry (holder only).
    pub fn exercise(env: Env, holder: Address, option_id: u32) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized_guard(&env)?;
        holder.require_auth();

        let mut option = get_option(&env, option_id)?;
        if option.holder != holder {
            return Err(Error::Unauthorized);
        }
        if option.status != OptionStatus::Active {
            return Err(Error::OptionNotActive);
        }
        if env.ledger().timestamp() > option.expiry {
            return Err(Error::OptionExpired);
        }

        option.status = OptionStatus::Exercised;
        set_option(&env, &option);

        // Settlement amount: for a call, holder pays strike and receives amount.
        // For a put, holder delivers amount and receives strike * amount.
        // In this playground contract we record the settlement value only.
        let settlement = option.strike_price;

        env.events()
            .publish((symbol_short!("exercised"), option_id), (holder, settlement));
        Ok(settlement)
    }

    /// Expire an option that has passed its expiry timestamp (anyone can call).
    pub fn expire_option(env: Env, option_id: u32) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;

        let mut option = get_option(&env, option_id)?;
        if option.status != OptionStatus::Active {
            return Err(Error::OptionNotActive);
        }
        if env.ledger().timestamp() <= option.expiry {
            return Err(Error::OptionNotExpired);
        }

        option.status = OptionStatus::Expired;
        set_option(&env, &option);

        env.events()
            .publish((symbol_short!("expired"), option_id), ());
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_option(env: Env, option_id: u32) -> Result<OptionContract, Error> {
        get_option(&env, option_id)
    }

    pub fn option_count(env: Env) -> u32 {
        get_option_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn assert_initialized_guard(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized_guard(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
