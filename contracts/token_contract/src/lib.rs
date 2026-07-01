// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # SEP-41 Token Contract
//!
//! Fully-compliant Soroban fungible token implementing the SEP-41 interface:
//! - `initialize`, `mint`, `burn`, `transfer`, `transfer_from`
//! - `approve` with ledger-based expiration
//! - `allowance`, `balance`, `decimals`, `name`, `symbol`, `total_supply`
//! - Admin-controlled minting and admin rotation

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_allowance, get_balance, get_decimals, get_name, get_symbol, get_total_supply,
    is_initialized, set_admin, set_allowance, set_balance, set_decimals, set_name, set_symbol,
    set_total_supply,
};
use crate::types::Error;

#[contract]
pub struct TokenContract;

#[contractimpl]
impl TokenContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        decimals: u32,
        name: String,
        symbol: String,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        if decimals > 18 {
            return Err(Error::InvalidDecimals);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_decimals(&env, decimals);
        set_name(&env, &name);
        set_symbol(&env, &symbol);
        set_total_supply(&env, 0);
        Ok(())
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        new_admin.require_auth();
        set_admin(&env, &new_admin);
        env.events()
            .publish((symbol_short!("set_admin"),), new_admin);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    // ── Minting & Burning ─────────────────────────────────────────────────────

    pub fn mint(env: Env, admin: Address, to: Address, amount: i128) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        let balance = get_balance(&env, &to);
        set_balance(&env, &to, balance + amount);
        let supply = get_total_supply(&env);
        set_total_supply(&env, supply + amount);
        env.events()
            .publish((symbol_short!("mint"), to.clone()), amount);
        Ok(())
    }

    pub fn burn(env: Env, from: Address, amount: i128) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        from.require_auth();
        let balance = get_balance(&env, &from);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(&env, &from, balance - amount);
        let supply = get_total_supply(&env);
        set_total_supply(&env, supply - amount);
        env.events()
            .publish((symbol_short!("burn"), from.clone()), amount);
        Ok(())
    }

    pub fn burn_from(
        env: Env,
        spender: Address,
        from: Address,
        amount: i128,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        spender.require_auth();
        Self::spend_allowance(&env, &from, &spender, amount)?;
        let balance = get_balance(&env, &from);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(&env, &from, balance - amount);
        let supply = get_total_supply(&env);
        set_total_supply(&env, supply - amount);
        env.events()
            .publish((symbol_short!("burn"), from.clone()), amount);
        Ok(())
    }

    // ── Transfers ─────────────────────────────────────────────────────────────

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        from.require_auth();
        let from_balance = get_balance(&env, &from);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(&env, &from, from_balance - amount);
        let to_balance = get_balance(&env, &to);
        set_balance(&env, &to, to_balance + amount);
        env.events()
            .publish((symbol_short!("transfer"), from.clone()), (to, amount));
        Ok(())
    }

    pub fn transfer_from(
        env: Env,
        spender: Address,
        from: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        if amount <= 0 {
            return Err(Error::ZeroAmount);
        }
        spender.require_auth();
        Self::spend_allowance(&env, &from, &spender, amount)?;
        let from_balance = get_balance(&env, &from);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }
        set_balance(&env, &from, from_balance - amount);
        let to_balance = get_balance(&env, &to);
        set_balance(&env, &to, to_balance + amount);
        env.events()
            .publish((symbol_short!("transfer"), from.clone()), (to, amount));
        Ok(())
    }

    // ── Allowances ────────────────────────────────────────────────────────────

    pub fn approve(
        env: Env,
        from: Address,
        spender: Address,
        amount: i128,
        expiration_ledger: u32,
    ) -> Result<(), Error> {
        Self::assert_initialized(&env)?;
        if amount < 0 {
            return Err(Error::NegativeAmount);
        }
        from.require_auth();
        set_allowance(&env, &from, &spender, amount, expiration_ledger);
        env.events().publish(
            (symbol_short!("approve"), from.clone()),
            (spender, amount, expiration_ledger),
        );
        Ok(())
    }

    pub fn allowance(env: Env, from: Address, spender: Address) -> i128 {
        let allowance = get_allowance(&env, &from, &spender);
        if env.ledger().sequence() > allowance.expiration_ledger {
            return 0;
        }
        allowance.amount
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn balance(env: Env, id: Address) -> i128 {
        get_balance(&env, &id)
    }

    pub fn total_supply(env: Env) -> i128 {
        get_total_supply(&env)
    }

    pub fn decimals(env: Env) -> u32 {
        get_decimals(&env)
    }

    pub fn name(env: Env) -> String {
        get_name(&env)
    }

    pub fn symbol(env: Env) -> String {
        get_symbol(&env)
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

    fn spend_allowance(env: &Env, from: &Address, spender: &Address, amount: i128) -> Result<(), Error> {
        let allowance = get_allowance(env, from, spender);
        if env.ledger().sequence() > allowance.expiration_ledger {
            return Err(Error::AllowanceExpired);
        }
        if allowance.amount < amount {
            return Err(Error::InsufficientAllowance);
        }
        set_allowance(
            env,
            from,
            spender,
            allowance.amount - amount,
            allowance.expiration_ledger,
        );
        Ok(())
    }
}
