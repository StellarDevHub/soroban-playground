// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

#![no_std]

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum WarrantyStatus {
    Active,
    Claimed,
    Expired,
}

#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Warranty {
    pub id: u32,
    pub owner: Address,
    pub product_id: u32,
    pub expiry: u64,
    pub status: WarrantyStatus,
}

#[contract]
pub struct WarrantyContract;

#[contractimpl]
impl WarrantyContract {
    pub fn register_product(env: Env, owner: Address, product_id: u32, duration: u64) -> u32 {
        owner.require_auth();
        let id = env.storage().instance().get(&symbol_short!("count")).unwrap_or(0u32) + 1;
        
        let warranty = Warranty {
            id,
            owner: owner.clone(),
            product_id,
            expiry: env.ledger().timestamp() + duration,
            status: WarrantyStatus::Active,
        };

        env.storage().instance().set(&id, &warranty);
        env.storage().instance().set(&symbol_short!("count"), &id);
        
        env.events().publish((symbol_short!("reg"), owner), id);
        id
    }

    pub fn get_warranty(env: Env, id: u32) -> Option<Warranty> {
        env.storage().instance().get(&id)
    }
}

mod test;
