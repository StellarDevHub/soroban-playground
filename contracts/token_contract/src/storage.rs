// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env, String};

use crate::types::{AllowanceKey, AllowanceValue, DataKey, Error, InstanceKey};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_decimals(env: &Env, decimals: u32) {
    env.storage().instance().set(&InstanceKey::Decimals, &decimals);
}

pub fn get_decimals(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::Decimals)
        .unwrap_or(7)
}

pub fn set_name(env: &Env, name: &String) {
    env.storage().instance().set(&InstanceKey::Name, name);
}

pub fn get_name(env: &Env) -> String {
    env.storage()
        .instance()
        .get(&InstanceKey::Name)
        .unwrap_or_else(|| String::from_str(env, ""))
}

pub fn set_symbol(env: &Env, symbol: &String) {
    env.storage().instance().set(&InstanceKey::Symbol, symbol);
}

pub fn get_symbol(env: &Env) -> String {
    env.storage()
        .instance()
        .get(&InstanceKey::Symbol)
        .unwrap_or_else(|| String::from_str(env, ""))
}

pub fn get_total_supply(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalSupply)
        .unwrap_or(0)
}

pub fn set_total_supply(env: &Env, supply: i128) {
    env.storage().instance().set(&InstanceKey::TotalSupply, &supply);
}

pub fn get_balance(env: &Env, account: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(account.clone()))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, account: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(account.clone()), &amount);
}

pub fn get_allowance(env: &Env, from: &Address, spender: &Address) -> AllowanceValue {
    let key = DataKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    env.storage()
        .temporary()
        .get(&key)
        .unwrap_or(AllowanceValue {
            amount: 0,
            expiration_ledger: 0,
        })
}

pub fn set_allowance(
    env: &Env,
    from: &Address,
    spender: &Address,
    amount: i128,
    expiration_ledger: u32,
) {
    let key = DataKey::Allowance(AllowanceKey {
        from: from.clone(),
        spender: spender.clone(),
    });
    if amount == 0 {
        env.storage().temporary().remove(&key);
        return;
    }
    let value = AllowanceValue {
        amount,
        expiration_ledger,
    };
    env.storage().temporary().set(&key, &value);
}
