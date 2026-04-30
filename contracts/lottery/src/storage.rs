use soroban_sdk::{Address, Env};

use crate::types::{Analytics, DataKey, Error, Round};

// ── Instance storage (cheap, limited size) ────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_ticket_price(env: &Env, price: i128) {
    env.storage().instance().set(&DataKey::TicketPrice, &price);
}

pub fn get_ticket_price(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::TicketPrice)
        .unwrap_or(0i128)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn get_round_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::RoundCount)
        .unwrap_or(0u32)
}

pub fn increment_round_count(env: &Env) -> u32 {
    let count = get_round_count(env) + 1;
    env.storage().instance().set(&DataKey::RoundCount, &count);
    count
}

pub fn set_analytics(env: &Env, analytics: &Analytics) {
    env.storage().instance().set(&DataKey::Analytics, analytics);
}

pub fn get_analytics(env: &Env) -> Analytics {
    env.storage()
        .instance()
        .get(&DataKey::Analytics)
        .unwrap_or(Analytics {
            total_rounds: 0,
            completed_rounds: 0,
            cancelled_rounds: 0,
            total_tickets_sold: 0,
            total_prize_pool: 0,
            total_prizes_claimed: 0,
        })
}

// ── Persistent storage (long-lived, larger data) ──────────────────────────────

pub fn set_round(env: &Env, round: &Round) {
    env.storage()
        .persistent()
        .set(&DataKey::Round(round.id), round);
}

pub fn get_round(env: &Env, round_id: u32) -> Result<Round, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Round(round_id))
        .ok_or(Error::RoundNotFound)
}

pub fn set_ticket_buyer(env: &Env, round_id: u32, ticket_id: u32, buyer: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::TicketBuyer(round_id, ticket_id), buyer);
}

pub fn get_ticket_buyer(env: &Env, round_id: u32, ticket_id: u32) -> Result<Address, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::TicketBuyer(round_id, ticket_id))
        .ok_or(Error::TicketNotFound)
}
