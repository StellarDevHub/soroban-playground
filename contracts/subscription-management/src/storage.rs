// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String, Vec, Uint128, symbol_short};
use crate::types::*;
use crate::errors::Error;

// Storage keys using symbol_short for efficiency
const INITIALIZED_KEY: soroban_sdk::Symbol = symbol_short!("INIT");
const ADMIN_KEY: soroban_sdk::Symbol = symbol_short!("ADMIN");
const PAUSED_KEY: soroban_sdk::Symbol = symbol_short!("PAUSE");
const PLATFORM_FEE_KEY: soroban_sdk::Symbol = symbol_short!("FEE");

const PLAN_PREFIX: soroban_sdk::Symbol = symbol_short!("PLAN_");
const SUBSCRIPTION_PREFIX: soroban_sdk::Symbol = symbol_short!("SUB_");
const USER_SUBSCRIPTION_PREFIX: soroban_sdk::Symbol = symbol_short!("USER_");
const PAYMENT_PREFIX: soroban_sdk::Symbol = symbol_short!("PAY_");

const ALL_PLANS_KEY: soroban_sdk::Symbol = symbol_short!("ALL_PLANS");
const ALL_SUBSCRIPTIONS_KEY: soroban_sdk::Symbol = symbol_short!("ALL_SUBS");

// === System Storage ===

pub fn is_initialized(env: &Env) -> bool {
    env.storage().persistent().has(&INITIALIZED_KEY)
}

pub fn set_initialized(env: &Env) {
    env.storage().persistent().set(&INITIALIZED_KEY, &true);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .persistent()
        .get(&ADMIN_KEY)
        .unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().persistent().set(&ADMIN_KEY, admin);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .persistent()
        .get(&PAUSED_KEY)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().persistent().set(&PAUSED_KEY, &paused);
}

pub fn get_platform_fee(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&PLATFORM_FEE_KEY)
        .unwrap_or(100) // Default 1% fee
}

pub fn set_platform_fee(env: &Env, fee_bps: u32) {
    env.storage().persistent().set(&PLATFORM_FEE_KEY, &fee_bps);
}

// === Plan Storage ===

pub fn plan_exists(env: &Env, plan_id: &String) -> bool {
    let key = (PLAN_PREFIX, plan_id.clone());
    env.storage().persistent().has(&key)
}

pub fn get_plan(env: &Env, plan_id: &String) -> Result<SubscriptionPlan, Error> {
    let key = (PLAN_PREFIX, plan_id.clone());
    env.storage()
        .persistent()
        .get(&key)
        .ok_or(Error::PlanNotFound)
}

pub fn set_plan(env: &Env, plan_id: &String, plan: &SubscriptionPlan) {
    let key = (PLAN_PREFIX, plan_id.clone());
    env.storage().persistent().set(&key, plan);
    
    // Update all plans list
    let mut all_plans = get_all_plan_ids(env);
    if !all_plans.contains(plan_id) {
        all_plans.push_back(plan_id.clone());
        set_all_plan_ids(env, &all_plans);
    }
}

pub fn get_all_plan_ids(env: &Env) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&ALL_PLANS_KEY)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_all_plan_ids(env: &Env, plan_ids: &Vec<String>) {
    env.storage().persistent().set(&ALL_PLANS_KEY, plan_ids);
}

// === Subscription Storage ===

pub fn get_subscription(env: &Env, subscription_id: &String) -> Result<Subscription, Error> {
    let key = (SUBSCRIPTION_PREFIX, subscription_id.clone());
    env.storage()
        .persistent()
        .get(&key)
        .ok_or(Error::SubscriptionNotFound)
}

pub fn set_subscription(env: &Env, subscription_id: &String, subscription: &Subscription) {
    let key = (SUBSCRIPTION_PREFIX, subscription_id.clone());
    env.storage().persistent().set(&key, subscription);
    
    // Update all subscriptions list
    let mut all_subs = get_all_subscription_ids(env);
    if !all_subs.contains(subscription_id) {
        all_subs.push_back(subscription_id.clone());
        set_all_subscription_ids(env, &all_subs);
    }
}

pub fn get_all_subscription_ids(env: &Env) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&ALL_SUBSCRIPTIONS_KEY)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_all_subscription_ids(env: &Env, subscription_ids: &Vec<String>) {
    env.storage().persistent().set(&ALL_SUBSCRIPTIONS_KEY, subscription_ids);
}

pub fn get_user_subscription_id(env: &Env, user: &Address) -> Option<String> {
    let key = (USER_SUBSCRIPTION_PREFIX, user.clone());
    env.storage().persistent().get(&key)
}

pub fn set_user_subscription(env: &Env, user: &Address, subscription_id: &String) {
    let key = (USER_SUBSCRIPTION_PREFIX, user.clone());
    env.storage().persistent().set(&key, subscription_id);
}

pub fn remove_user_subscription(env: &Env, user: &Address) {
    let key = (USER_SUBSCRIPTION_PREFIX, user.clone());
    env.storage().persistent().remove(&key);
}

pub fn has_active_subscription(env: &Env, user: &Address) -> bool {
    if let Some(sub_id) = get_user_subscription_id(env, user) {
        if let Ok(subscription) = get_subscription(env, &sub_id) {
            return subscription.status == SubscriptionStatus::Active;
        }
    }
    false
}

// === Payment Storage ===

pub fn get_payment(env: &Env, payment_id: &String) -> Result<PaymentRecord, Error> {
    let key = (PAYMENT_PREFIX, payment_id.clone());
    env.storage()
        .persistent()
        .get(&key)
        .ok_or(Error::PaymentFailed) // Using generic error for simplicity
}

pub fn set_payment(env: &Env, payment_id: &String, payment: &PaymentRecord) {
    let key = (PAYMENT_PREFIX, payment_id.clone());
    env.storage().persistent().set(&key, payment);
}

// === Utility Functions ===

pub fn generate_subscription_id(env: &Env, user: &Address) -> String {
    let timestamp = env.ledger().timestamp();
    let random = env.prng().gen::<u64>();
    String::from_str(env, &format!("sub_{}_{}_{}", timestamp, user, random))
}

pub fn calculate_platform_fee(env: &Env, amount: Uint128) -> Result<Uint128, Error> {
    let fee_bps = get_platform_fee(env);
    let fee = amount * fee_bps / 10000;
    Ok(fee)
}

// === Access Control ===

pub fn ensure_initialized(env: &Env) -> Result<(), Error> {
    if !is_initialized(env) {
        return Err(Error::NotInitialized);
    }
    Ok(())
}

pub fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
    let admin = get_admin(env);
    
    if caller != &admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn require_not_paused(env: &Env) -> Result<(), Error> {
    if is_paused(env) {
        return Err(Error::ContractPaused);
    }
    Ok(())
}
