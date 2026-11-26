// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use crate::types::Error;
use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    FlashLoanFeeBps,
    UserCollateral(Address, Address),
    UserDebt(Address),
    TokenPrice(Address),
    DexRate(Address, Address),
    MaxPriceDeviationBps,
    BaseSwitchFeeBps,
    DeviationFeeMultiplierBps,
    ProtocolFees(Address),
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_flash_loan_fee_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::FlashLoanFeeBps)
        .unwrap_or(9) // 0.09% default flash loan fee
}

pub fn set_flash_loan_fee_bps(env: &Env, bps: i128) {
    env.storage()
        .instance()
        .set(&DataKey::FlashLoanFeeBps, &bps);
}

pub fn get_user_collateral(env: &Env, user: &Address, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserCollateral(user.clone(), token.clone()))
        .unwrap_or(0)
}

pub fn set_user_collateral(env: &Env, user: &Address, token: &Address, amount: i128) {
    env.storage().persistent().set(
        &DataKey::UserCollateral(user.clone(), token.clone()),
        &amount,
    );
}

pub fn get_user_debt(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::UserDebt(user.clone()))
        .unwrap_or(0)
}

pub fn set_user_debt(env: &Env, user: &Address, debt: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::UserDebt(user.clone()), &debt);
}

pub fn get_token_price(env: &Env, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::TokenPrice(token.clone()))
        .unwrap_or(10_000_000) // Default $1.00 (scaled 1e7)
}

pub fn set_token_price(env: &Env, token: &Address, price: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::TokenPrice(token.clone()), &price);
}

pub fn get_dex_rate(env: &Env, from: &Address, to: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::DexRate(from.clone(), to.clone()))
        .unwrap_or(10_000) // 1:1 default exchange rate
}

pub fn set_dex_rate(env: &Env, from: &Address, to: &Address, rate_bps: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::DexRate(from.clone(), to.clone()), &rate_bps);
}

/// Default maximum tolerated deviation between DEX rate and oracle rate (5%).
pub const DEFAULT_MAX_PRICE_DEVIATION_BPS: i128 = 500;
/// Default share of the observed deviation that is charged as extra switching fee (50%).
pub const DEFAULT_DEVIATION_FEE_MULTIPLIER_BPS: i128 = 5_000;

pub fn get_max_price_deviation_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MaxPriceDeviationBps)
        .unwrap_or(DEFAULT_MAX_PRICE_DEVIATION_BPS)
}

pub fn set_max_price_deviation_bps(env: &Env, bps: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MaxPriceDeviationBps, &bps);
}

pub fn get_base_switch_fee_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::BaseSwitchFeeBps)
        .unwrap_or(0)
}

pub fn set_base_switch_fee_bps(env: &Env, bps: i128) {
    env.storage()
        .instance()
        .set(&DataKey::BaseSwitchFeeBps, &bps);
}

pub fn get_deviation_fee_multiplier_bps(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::DeviationFeeMultiplierBps)
        .unwrap_or(DEFAULT_DEVIATION_FEE_MULTIPLIER_BPS)
}

pub fn set_deviation_fee_multiplier_bps(env: &Env, bps: i128) {
    env.storage()
        .instance()
        .set(&DataKey::DeviationFeeMultiplierBps, &bps);
}

pub fn get_protocol_fees(env: &Env, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::ProtocolFees(token.clone()))
        .unwrap_or(0)
}

pub fn add_protocol_fees(env: &Env, token: &Address, amount: i128) {
    let total = get_protocol_fees(env, token) + amount;
    env.storage()
        .persistent()
        .set(&DataKey::ProtocolFees(token.clone()), &total);
}
