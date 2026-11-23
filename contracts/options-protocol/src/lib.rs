// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Options Protocol
//!
//! On-chain call/put options: a writer locks collateral, a holder pays a
//! premium, and can exercise before expiry.

#![no_std]

mod math;
mod storage;
#[cfg(test)]
mod proptest;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, String};

use crate::storage::{
    get_admin, get_margin_account, get_margin_config, get_margin_position, get_option,
    get_option_count, get_price, has_margin_config, has_margin_position, is_initialized, is_paused,
    remove_margin_position, set_admin, set_margin_account, set_margin_config, set_margin_position,
    set_option, set_option_count, set_paused, set_price,
};
pub use crate::types::{
    Error, Greeks, GreeksInput, MarginAccount, MarginConfig, MarginPosition, OptionContract,
    OptionKind, OptionStatus, PriceData,
};

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

    /// Configure the token-backed margin pool once. Prices may only be
    /// submitted by `oracle`; keepers can then permissionlessly run checks.
    pub fn configure_margin_pool(
        env: Env,
        admin: Address,
        settlement_token: Address,
        oracle: Address,
        maintenance_margin_bps: u32,
        max_price_age: u64,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        if has_margin_config(&env) {
            return Err(Error::PoolAlreadyConfigured);
        }
        if maintenance_margin_bps == 0 || maintenance_margin_bps > 10_000 || max_price_age == 0 {
            return Err(Error::InvalidMarginConfig);
        }
        let config = MarginConfig {
            settlement_token,
            oracle,
            maintenance_margin_bps,
            max_price_age,
        };
        set_margin_config(&env, &config);
        env.events().publish((symbol_short!("margincfg"),), config);
        Ok(())
    }

    /// Store an authenticated oracle observation.
    pub fn update_price(
        env: Env,
        oracle: Address,
        underlying: String,
        price: i128,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        let config = get_margin_config(&env)?;
        oracle.require_auth();
        if oracle != config.oracle {
            return Err(Error::Unauthorized);
        }
        if price <= 0 {
            return Err(Error::InvalidPrice);
        }
        let observation = PriceData {
            price,
            updated_at: env.ledger().timestamp(),
        };
        set_price(&env, &underlying, &observation);
        env.events()
            .publish((symbol_short!("price"), underlying), observation);
        Ok(())
    }

    /// Deposit settlement tokens into a writer's pooled margin account.
    pub fn deposit_margin(env: Env, writer: Address, amount: i128) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized_guard(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        writer.require_auth();
        let config = get_margin_config(&env)?;
        let mut account = get_margin_account(&env, &writer);
        account.balance = account
            .balance
            .checked_add(amount)
            .ok_or(Error::MathOverflow)?;
        token::Client::new(&env, &config.settlement_token).transfer(
            &writer,
            &env.current_contract_address(),
            &amount,
        );
        set_margin_account(&env, &writer, &account);
        env.events()
            .publish((symbol_short!("deposit"), writer), amount);
        Ok(())
    }

    /// Withdraw tokens that are not reserved by an open position.
    pub fn withdraw_margin(env: Env, writer: Address, amount: i128) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        writer.require_auth();
        let config = get_margin_config(&env)?;
        let mut account = get_margin_account(&env, &writer);
        let available = account
            .balance
            .checked_sub(account.locked)
            .ok_or(Error::MathOverflow)?;
        if amount > available {
            return Err(Error::InsufficientMargin);
        }
        account.balance -= amount;
        set_margin_account(&env, &writer, &account);
        token::Client::new(&env, &config.settlement_token).transfer(
            &env.current_contract_address(),
            &writer,
            &amount,
        );
        env.events()
            .publish((symbol_short!("withdraw"), writer), amount);
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

    /// Write an expiry-only option backed by the shared margin pool.
    /// `max_payout` caps the writer's liability and is enforced at settlement.
    pub fn write_collateralized_option(
        env: Env,
        writer: Address,
        holder: Address,
        underlying: String,
        strike_price: i128,
        premium: i128,
        amount: i128,
        expiry: u64,
        kind: OptionKind,
        max_payout: i128,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized_guard(&env)?;
        writer.require_auth();
        holder.require_auth();
        Self::validate_option(
            &env,
            &writer,
            &holder,
            strike_price,
            premium,
            amount,
            expiry,
        )?;
        if max_payout <= 0 {
            return Err(Error::InvalidMaxPayout);
        }
        let config = get_margin_config(&env)?;
        let spot = Self::fresh_price(&env, &underlying, &config)?;
        let required = Self::required_margin(
            spot,
            strike_price,
            amount,
            kind,
            max_payout,
            config.maintenance_margin_bps,
        )?;
        let mut account = get_margin_account(&env, &writer);
        let available = account
            .balance
            .checked_sub(account.locked)
            .ok_or(Error::MathOverflow)?;
        if available < required {
            return Err(Error::InsufficientMargin);
        }
        if premium > 0 {
            token::Client::new(&env, &config.settlement_token).transfer(&holder, &writer, &premium);
        }

        let id = get_option_count(&env)
            .checked_add(1)
            .ok_or(Error::MathOverflow)?;
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
        account.locked = account
            .locked
            .checked_add(required)
            .ok_or(Error::MathOverflow)?;
        set_margin_account(&env, &writer, &account);
        set_margin_position(
            &env,
            id,
            &MarginPosition {
                locked: required,
                max_payout,
            },
        );
        set_option(&env, &option);
        set_option_count(&env, id);
        env.events()
            .publish((symbol_short!("collatopt"), id), (writer, holder, required));
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
        if has_margin_position(&env, option_id) {
            return Err(Error::EuropeanOnly);
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

    /// Cancel a collateralized option before expiry with consent from both
    /// counterparties, releasing all reserved margin to the writer.
    pub fn cancel_collateralized_option(
        env: Env,
        writer: Address,
        holder: Address,
        option_id: u32,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        writer.require_auth();
        holder.require_auth();
        let mut option = get_option(&env, option_id)?;
        if option.writer != writer || option.holder != holder {
            return Err(Error::Unauthorized);
        }
        if option.status != OptionStatus::Active {
            return Err(Error::OptionNotActive);
        }
        if env.ledger().timestamp() >= option.expiry {
            return Err(Error::OptionExpired);
        }
        get_margin_position(&env, option_id)?;
        Self::release_position(&env, &option)?;
        option.status = OptionStatus::Cancelled;
        set_option(&env, &option);
        env.events()
            .publish((symbol_short!("cancelled"), option_id), (writer, holder));
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
        if has_margin_position(&env, option_id) {
            return Err(Error::EuropeanOnly);
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

        env.events().publish(
            (symbol_short!("exercised"), option_id),
            (holder, settlement),
        );
        Ok(settlement)
    }

    /// Expire an option that has passed its expiry timestamp (anyone can call).
    pub fn expire_option(env: Env, option_id: u32) -> Result<(), Error> {
        Self::assert_initialized_guard(&env)?;

        let mut option = get_option(&env, option_id)?;
        if option.status != OptionStatus::Active {
            return Err(Error::OptionNotActive);
        }
        if has_margin_position(&env, option_id) {
            return Err(Error::EuropeanOnly);
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

    /// Rebalance a position against the latest authenticated price. Keepers
    /// call this after price updates; `false` means a margin call was triggered.
    pub fn check_margin(env: Env, option_id: u32) -> Result<bool, Error> {
        Self::assert_not_paused(&env)?;
        let mut option = get_option(&env, option_id)?;
        if option.status != OptionStatus::Active && option.status != OptionStatus::MarginCalled {
            return Err(Error::OptionNotActive);
        }
        let config = get_margin_config(&env)?;
        let spot = Self::fresh_price(&env, &option.underlying, &config)?;
        let mut position = get_margin_position(&env, option_id)?;
        let required = Self::required_margin(
            spot,
            option.strike_price,
            option.amount,
            option.kind,
            position.max_payout,
            config.maintenance_margin_bps,
        )?;
        let mut account = get_margin_account(&env, &option.writer);
        let unlocked = account.balance - account.locked;
        let additional = required - position.locked;
        if additional > unlocked {
            option.status = OptionStatus::MarginCalled;
            set_option(&env, &option);
            env.events().publish(
                (symbol_short!("margcall"), option_id),
                additional - unlocked,
            );
            return Ok(false);
        }
        account.locked = account
            .locked
            .checked_add(additional)
            .ok_or(Error::MathOverflow)?;
        position.locked = required;
        option.status = OptionStatus::Active;
        set_margin_account(&env, &option.writer, &account);
        set_margin_position(&env, option_id, &position);
        set_option(&env, &option);
        env.events()
            .publish((symbol_short!("marginok"), option_id), required);
        Ok(true)
    }

    /// Restore a called position after the writer has deposited more margin.
    pub fn cure_margin_call(env: Env, writer: Address, option_id: u32) -> Result<(), Error> {
        writer.require_auth();
        let option = get_option(&env, option_id)?;
        if option.writer != writer {
            return Err(Error::Unauthorized);
        }
        if option.status != OptionStatus::MarginCalled {
            return Err(Error::MarginCallNotActive);
        }
        if !Self::check_margin(env.clone(), option_id)? {
            return Err(Error::InsufficientMargin);
        }
        Ok(())
    }

    /// Cash-settle a collateralized European option at or after expiry using
    /// the latest authenticated price. Anyone may invoke settlement.
    pub fn settle_option(env: Env, option_id: u32) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        let mut option = get_option(&env, option_id)?;
        if option.status != OptionStatus::Active && option.status != OptionStatus::MarginCalled {
            return Err(Error::OptionNotActive);
        }
        if env.ledger().timestamp() < option.expiry {
            return Err(Error::OptionNotExpired);
        }
        let config = get_margin_config(&env)?;
        let spot = Self::fresh_price(&env, &option.underlying, &config)?;
        let position = get_margin_position(&env, option_id)?;
        let payout = Self::intrinsic_value(spot, option.strike_price, option.amount, option.kind)?
            .min(position.max_payout);
        if payout > position.locked {
            return Err(Error::InsufficientMargin);
        }
        let mut account = get_margin_account(&env, &option.writer);
        account.locked -= position.locked;
        account.balance -= payout;
        set_margin_account(&env, &option.writer, &account);
        remove_margin_position(&env, option_id);
        option.status = if payout > 0 {
            OptionStatus::Exercised
        } else {
            OptionStatus::Expired
        };
        set_option(&env, &option);
        if payout > 0 {
            token::Client::new(&env, &config.settlement_token).transfer(
                &env.current_contract_address(),
                &option.holder,
                &payout,
            );
        }
        env.events().publish(
            (symbol_short!("settled"), option_id),
            (&option.holder, payout, spot),
        );
        Ok(payout)
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

    pub fn get_margin_config(env: Env) -> Result<MarginConfig, Error> {
        get_margin_config(&env)
    }

    pub fn get_margin_account(env: Env, writer: Address) -> MarginAccount {
        get_margin_account(&env, &writer)
    }

    pub fn get_margin_position(env: Env, option_id: u32) -> Result<MarginPosition, Error> {
        get_margin_position(&env, option_id)
    }

    pub fn get_price(env: Env, underlying: String) -> Result<PriceData, Error> {
        get_price(&env, &underlying)
    }

    /// Calculate a Black-Scholes theoretical price and Greeks without storage.
    pub fn calculate_greeks(_env: Env, input: GreeksInput) -> Result<Greeks, Error> {
        math::black_scholes(&input)
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

    fn validate_option(
        env: &Env,
        writer: &Address,
        holder: &Address,
        strike_price: i128,
        premium: i128,
        amount: i128,
        expiry: u64,
    ) -> Result<(), Error> {
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
        Ok(())
    }

    fn fresh_price(env: &Env, underlying: &String, config: &MarginConfig) -> Result<i128, Error> {
        let observation = get_price(env, underlying)?;
        let age = env
            .ledger()
            .timestamp()
            .checked_sub(observation.updated_at)
            .ok_or(Error::InvalidPrice)?;
        if age > config.max_price_age {
            return Err(Error::StalePrice);
        }
        Ok(observation.price)
    }

    fn intrinsic_value(
        spot: i128,
        strike: i128,
        amount: i128,
        kind: OptionKind,
    ) -> Result<i128, Error> {
        let price_difference = match kind {
            OptionKind::Call => spot.saturating_sub(strike),
            OptionKind::Put => strike.saturating_sub(spot),
        }
        .max(0);
        math::mul(price_difference, amount)
    }

    fn required_margin(
        spot: i128,
        strike: i128,
        amount: i128,
        kind: OptionKind,
        max_payout: i128,
        maintenance_margin_bps: u32,
    ) -> Result<i128, Error> {
        let intrinsic = Self::intrinsic_value(spot, strike, amount, kind)?;
        let notional = math::mul(spot, amount)?;
        let maintenance = notional
            .checked_mul(maintenance_margin_bps as i128)
            .and_then(|value| value.checked_div(10_000))
            .ok_or(Error::MathOverflow)?;
        intrinsic
            .checked_add(maintenance)
            .ok_or(Error::MathOverflow)
            .map(|required| required.min(max_payout))
    }

    fn release_position(env: &Env, option: &OptionContract) -> Result<(), Error> {
        if !has_margin_position(env, option.id) {
            return Ok(());
        }
        let position = get_margin_position(env, option.id)?;
        let mut account = get_margin_account(env, &option.writer);
        account.locked = account
            .locked
            .checked_sub(position.locked)
            .ok_or(Error::MathOverflow)?;
        set_margin_account(env, &option.writer, &account);
        remove_margin_position(env, option.id);
        Ok(())
    }
}
