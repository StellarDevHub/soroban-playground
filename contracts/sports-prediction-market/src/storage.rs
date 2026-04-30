use soroban_sdk::{Address, Env, Symbol};

use crate::types::{BetPosition, Error, SportMarket};

const ADMIN_KEY: &str = "admin";
const PAUSED_KEY: &str = "paused";
const MARKET_COUNT_KEY: &str = "mkt_cnt";

fn market_key(env: &Env, id: u32) -> Symbol {
    Symbol::new(env, &format!("sm{}", id))
}

fn position_key(env: &Env, market_id: u32, bettor: &Address) -> Symbol {
    let addr = bettor.to_string();
    let short: &str = if addr.len() >= 6 { &addr[..6] } else { &addr };
    Symbol::new(env, &format!("bp{}_{}", market_id, short))
}

// ── Admin / pause ─────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&Symbol::new(env, ADMIN_KEY))
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

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<Symbol, bool>(&Symbol::new(env, PAUSED_KEY))
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage()
        .instance()
        .set(&Symbol::new(env, PAUSED_KEY), &paused);
}

// ── Market count ──────────────────────────────────────────────────────────────

pub fn get_market_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, MARKET_COUNT_KEY))
        .unwrap_or(0u32)
}

pub fn increment_market_count(env: &Env) -> u32 {
    let count = get_market_count(env) + 1;
    env.storage()
        .instance()
        .set(&Symbol::new(env, MARKET_COUNT_KEY), &count);
    count
}

// ── Markets ───────────────────────────────────────────────────────────────────

pub fn set_market(env: &Env, market: &SportMarket) {
    env.storage()
        .persistent()
        .set(&market_key(env, market.id), market);
}

pub fn get_market(env: &Env, id: u32) -> Result<SportMarket, Error> {
    env.storage()
        .persistent()
        .get(&market_key(env, id))
        .ok_or(Error::MarketNotFound)
}

// ── Positions ─────────────────────────────────────────────────────────────────

pub fn set_position(env: &Env, pos: &BetPosition) {
    env.storage()
        .persistent()
        .set(&position_key(env, pos.market_id, &pos.bettor), pos);
}

pub fn get_position(env: &Env, market_id: u32, bettor: &Address) -> Option<BetPosition> {
    env.storage()
        .persistent()
        .get(&position_key(env, market_id, bettor))
}
