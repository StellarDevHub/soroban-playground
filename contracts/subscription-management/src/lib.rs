// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Subscription Management System
//!
//! A comprehensive subscription management smart contract

#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env, String, symbol_short};

#[contract]
pub struct SubscriptionManager;

#[contractimpl]
impl SubscriptionManager {
    /// Initialize the subscription management system
    pub fn initialize(
        env: Env,
        admin: Address,
        platform_fee_bps: u32,
    ) -> Result<(), soroban_sdk::Error> {
        admin.require_auth();
        
        if platform_fee_bps > 1000 { // Max 10% fee
            return Err(soroban_sdk::Error::from_contract_error(1));
        }
        
        env.storage().persistent().set(&symbol_short!("ADMIN"), &admin);
        env.storage().persistent().set(&symbol_short!("FEE"), &platform_fee_bps);
        env.storage().persistent().set(&symbol_short!("PAUSED"), &false);
        env.storage().persistent().set(&symbol_short!("INIT"), &true);
        
        env.events().publish(
            (symbol_short!("init"),),
            admin
        );
        
        Ok(())
    }
    
    /// Create a new subscription plan
    pub fn create_plan(
        env: Env,
        caller: Address,
        plan_id: String,
        name: String,
        price_per_period: i128,
        billing_period: u64,
    ) -> Result<(), soroban_sdk::Error> {
        caller.require_auth();
        
        if price_per_period == 0 || billing_period == 0 {
            return Err(soroban_sdk::Error::from_contract_error(2));
        }
        
        let plan_key = (symbol_short!("PLAN"), plan_id.clone());
        if env.storage().persistent().has(&plan_key) {
            return Err(soroban_sdk::Error::from_contract_error(3));
        }
        
        let plan = (name, price_per_period, billing_period, true);
        env.storage().persistent().set(&plan_key, &plan);
        
        env.events().publish(
            (symbol_short!("plan_mk"),),
            plan_id
        );
        
        Ok(())
    }
    
    /// Get plan details
    pub fn get_plan_details(
        env: Env,
        plan_id: String,
    ) -> Result<(String, i128, u64, bool), soroban_sdk::Error> {
        let plan_key = (symbol_short!("PLAN"), plan_id);
        env.storage()
            .persistent()
            .get(&plan_key)
            .ok_or(soroban_sdk::Error::from_contract_error(4))
    }
    
    /// Emergency pause/unpause the contract
    pub fn set_pause(
        env: Env,
        caller: Address,
        paused: bool,
    ) -> Result<(), soroban_sdk::Error> {
        caller.require_auth();
        
        let admin_key = symbol_short!("ADMIN");
        let admin: Address = env.storage()
            .persistent()
            .get(&admin_key)
            .ok_or(soroban_sdk::Error::from_contract_error(5))?;
        
        if caller != admin {
            return Err(soroban_sdk::Error::from_contract_error(6));
        }
        
        env.storage().persistent().set(&symbol_short!("PAUSED"), &paused);
        
        env.events().publish(
            (symbol_short!("pause"),),
            paused
        );
        
        Ok(())
    }
}
