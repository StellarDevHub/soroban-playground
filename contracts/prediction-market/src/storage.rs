use soroban_sdk::{Address, Env, Symbol};

use crate::types::{Error, Market, Position};

const ADMIN_KEY: &str = "admin";
const MARKET_COUNT_KEY: &str = "mkt_count";

fn market_key(env: &Env, id: u32) -> Symbol {
    Symbol::new(env, &format!("mkt_{}", id))
}

fn position_key(env: &Env, market_id: u32, trader: &Address) -> Symbol {
    // Use a composite key: "pos_{market_id}_{trader_short}"
    // Soroban Symbol max 32 chars; encode market_id + first 8 chars of address string
    let addr_str = trader.to_string();
    let short: &str = if addr_str.len() >= 8 { &addr_str[..8] } else { &addr_str };
    Symbol::new(env, &format!("p{}_{}", market_id, short))
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&Symbol::new(env, ADMIN_KEY))
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&Symbol::new(env, ADMIN_KEY), admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&Symbol::new(env, ADMIN_KEY))
        .ok_or(Error::NotInitialized)
}

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

pub fn set_market(env: &Env, market: &Market) {
    env.storage()
        .persistent()
        .set(&market_key(env, market.id), market);
}

pub fn get_market(env: &Env, id: u32) -> Result<Market, Error> {
    env.storage()
        .persistent()
        .get(&market_key(env, id))
        .ok_or(Error::MarketNotFound)
}

pub fn set_position(env: &Env, position: &Position) {
    env.storage()
        .persistent()
        .set(&position_key(env, position.market_id, &position.trader), position);
}

pub fn get_position(env: &Env, market_id: u32, trader: &Address) -> Option<Position> {
    env.storage()
        .persistent()
        .get(&position_key(env, market_id, trader))
}
