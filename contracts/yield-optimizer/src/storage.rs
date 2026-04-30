// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{BacktestEntry, DataKey, Error, InstanceKey, Position, Protocol, Vault};

const LEDGER_TTL: u32 = 518400; // ~30 days

// ── Instance ──────────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
    env.storage().instance().extend_ttl(LEDGER_TTL, LEDGER_TTL);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&InstanceKey::Admin).ok_or(Error::NotInitialized)
}

pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &v);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&InstanceKey::Paused).unwrap_or(false)
}

macro_rules! count_fns {
    ($set:ident, $get:ident, $key:ident) => {
        pub fn $set(env: &Env, n: u32) {
            env.storage().instance().set(&InstanceKey::$key, &n);
        }
        pub fn $get(env: &Env) -> u32 {
            env.storage().instance().get(&InstanceKey::$key).unwrap_or(0)
        }
    };
}

count_fns!(set_protocol_count, get_protocol_count, ProtocolCount);
count_fns!(set_vault_count, get_vault_count, VaultCount);
count_fns!(set_backtest_count, get_backtest_count, BacktestCount);

// ── Persistent ────────────────────────────────────────────────────────────────

macro_rules! persistent_fns {
    ($set:ident, $get:ident, $has:ident, $T:ty, $key_variant:ident, $not_found:ident) => {
        pub fn $set(env: &Env, id: u32, val: &$T) {
            let key = DataKey::$key_variant(id);
            env.storage().persistent().set(&key, val);
            env.storage().persistent().extend_ttl(&key, LEDGER_TTL, LEDGER_TTL);
        }
        pub fn $get(env: &Env, id: u32) -> Result<$T, Error> {
            env.storage().persistent().get(&DataKey::$key_variant(id)).ok_or(Error::$not_found)
        }
        pub fn $has(env: &Env, id: u32) -> bool {
            env.storage().persistent().has(&DataKey::$key_variant(id))
        }
    };
}

persistent_fns!(set_protocol, get_protocol, has_protocol, Protocol, Protocol, ProtocolNotFound);
persistent_fns!(set_vault, get_vault, has_vault, Vault, Vault, VaultNotFound);
persistent_fns!(set_backtest, get_backtest, has_backtest, BacktestEntry, Backtest, BacktestNotFound);

pub fn set_position(env: &Env, vault_id: u32, user: &Address, pos: &Position) {
    let key = DataKey::Position(vault_id, user.clone());
    env.storage().persistent().set(&key, pos);
    env.storage().persistent().extend_ttl(&key, LEDGER_TTL, LEDGER_TTL);
}

pub fn get_position(env: &Env, vault_id: u32, user: &Address) -> Result<Position, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Position(vault_id, user.clone()))
        .ok_or(Error::NoPosition)
}

pub fn has_position(env: &Env, vault_id: u32, user: &Address) -> bool {
    env.storage().persistent().has(&DataKey::Position(vault_id, user.clone()))
}

pub fn remove_position(env: &Env, vault_id: u32, user: &Address) {
    env.storage().persistent().remove(&DataKey::Position(vault_id, user.clone()));
}
