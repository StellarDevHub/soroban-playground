use soroban_sdk::{Address, Env, Symbol, Vec};

use crate::types::{BurnRecord, BuybackConfig, BuybackStats, Error, PurchaseRecord};

const ADMIN_KEY: &str = "admin";
const CONFIG_KEY: &str = "config";
const STATS_KEY: &str = "stats";
const TREASURY_KEY: &str = "treasury";
const RECORD_COUNT_KEY: &str = "rec_count";
const PURCHASE_HISTORY_KEY: &str = "purchases";
const BURN_HISTORY_KEY: &str = "burns";
const MAX_HISTORY: u32 = 10;

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .has(&Symbol::new(env, ADMIN_KEY))
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, ADMIN_KEY), admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, ADMIN_KEY))
        .ok_or(Error::NotInitialized)
}

pub fn set_config(env: &Env, config: &BuybackConfig) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, CONFIG_KEY), config);
}

pub fn get_config(env: &Env) -> Result<BuybackConfig, Error> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, CONFIG_KEY))
        .ok_or(Error::NotInitialized)
}

pub fn set_stats(env: &Env, stats: &BuybackStats) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, STATS_KEY), stats);
}

pub fn get_stats(env: &Env) -> Result<BuybackStats, Error> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, STATS_KEY))
        .ok_or(Error::NotInitialized)
}

pub fn set_treasury_balance(env: &Env, balance: i128) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, TREASURY_KEY), &balance);
}

pub fn get_treasury_balance(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, TREASURY_KEY))
        .unwrap_or(0i128)
}

pub fn next_record_id(env: &Env) -> u32 {
    let count: u32 = env
        .storage()
        .instance()
        .get(&Symbol::new(env, RECORD_COUNT_KEY))
        .unwrap_or(0u32)
        + 1;
    env.storage()
        .instance()
        .set(&Symbol::new(env, RECORD_COUNT_KEY), &count);
    count
}

pub fn add_purchase_record(env: &Env, record: &PurchaseRecord) {
    let key = Symbol::new(env, PURCHASE_HISTORY_KEY);
    let mut history: Vec<PurchaseRecord> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));

    if history.len() >= MAX_HISTORY {
        // Remove oldest entry to keep bounded size
        let mut trimmed = Vec::new(env);
        for i in 1..history.len() {
            trimmed.push_back(history.get(i).unwrap());
        }
        history = trimmed;
    }
    history.push_back(record.clone());
    env.storage().instance().set(&key, &history);
}

pub fn get_purchase_history(env: &Env) -> Vec<PurchaseRecord> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, PURCHASE_HISTORY_KEY))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn add_burn_record(env: &Env, record: &BurnRecord) {
    let key = Symbol::new(env, BURN_HISTORY_KEY);
    let mut history: Vec<BurnRecord> = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));

    if history.len() >= MAX_HISTORY {
        let mut trimmed = Vec::new(env);
        for i in 1..history.len() {
            trimmed.push_back(history.get(i).unwrap());
        }
        history = trimmed;
    }
    history.push_back(record.clone());
    env.storage().instance().set(&key, &history);
}

pub fn get_burn_history(env: &Env) -> Vec<BurnRecord> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, BURN_HISTORY_KEY))
        .unwrap_or_else(|| Vec::new(env))
}
