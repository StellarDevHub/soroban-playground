use soroban_sdk::{Env, Address, symbol_short, Symbol};
use crate::types::{SportMarket, Bet, Error};

const ADMIN: Symbol = symbol_short!("ADMIN");
const IS_INIT: Symbol = symbol_short!("IS_INIT");
const MARKET_COUNT: Symbol = symbol_short!("M_COUNT");
const PAUSED: Symbol = symbol_short!("PAUSED");

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&IS_INIT)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&IS_INIT, &true);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&ADMIN).ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&ADMIN, admin);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&PAUSED).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&PAUSED, &paused);
}

pub fn get_market_count(env: &Env) -> u32 {
    env.storage().instance().get(&MARKET_COUNT).unwrap_or(0)
}

pub fn increment_market_count(env: &Env) -> u32 {
    let count = get_market_count(env) + 1;
    env.storage().instance().set(&MARKET_COUNT, &count);
    count
}

pub fn get_market(env: &Env, id: u32) -> Result<SportMarket, Error> {
    env.storage().persistent().get(&Symbol::new(env, "MARKET")).unwrap_or_else(|| {
        // Fallback to a dynamic key if needed, but for simplicity we use a map-like structure
        // In Soroban, it's better to use DataKey
        Err(Error::MarketNotFound)
    });
    
    // Proper way with DataKey
    let key = DataKey::Market(id);
    env.storage().persistent().get(&key).ok_or(Error::MarketNotFound)
}

pub fn set_market(env: &Env, market: &SportMarket) {
    let key = DataKey::Market(market.id);
    env.storage().persistent().set(&key, market);
}

pub fn get_bet(env: &Env, market_id: u32, bettor: &Address) -> Option<Bet> {
    let key = DataKey::Bet(market_id, bettor.clone());
    env.storage().persistent().get(&key)
}

pub fn set_bet(env: &Env, bet: &Bet) {
    let key = DataKey::Bet(bet.market_id, bet.bettor.clone());
    env.storage().persistent().set(&key, bet);
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum DataKey {
    Market(u32),
    Bet(u32, Address),
}
