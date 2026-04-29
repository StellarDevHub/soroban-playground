use soroban_sdk::{Address, Env, Symbol};

use crate::types::{AirdropCampaign, Error};

const ADMIN_KEY: &str = "admin";
const PAUSED_KEY: &str = "paused";
const COUNT_KEY: &str = "count";

// ── Instance storage (contract-level) ────────────────────────────────────────

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

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&Symbol::new(env, PAUSED_KEY))
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&Symbol::new(env, PAUSED_KEY), &paused);
}

pub fn next_id(env: &Env) -> u32 {
    let count: u32 = env
        .storage()
        .instance()
        .get(&Symbol::new(env, COUNT_KEY))
        .unwrap_or(0u32)
        + 1;
    env.storage().instance().set(&Symbol::new(env, COUNT_KEY), &count);
    count
}

pub fn get_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&Symbol::new(env, COUNT_KEY))
        .unwrap_or(0u32)
}

// ── Persistent storage (per-campaign) ────────────────────────────────────────

fn campaign_key(env: &Env, id: u32) -> Symbol {
    Symbol::new(env, &soroban_sdk::format_in_env!(env, "ac_{}", id))
}

fn claimed_key(env: &Env, id: u32, claimer: &Address) -> (u32, Address) {
    let _ = env; // env not needed for tuple key
    (id, claimer.clone())
}

fn allowlist_key(id: u32, addr: &Address) -> (u32, Address) {
    (id, addr.clone())
}

pub fn save_campaign(env: &Env, c: &AirdropCampaign) {
    env.storage().persistent().set(&campaign_key(env, c.id), c);
}

pub fn load_campaign(env: &Env, id: u32) -> Result<AirdropCampaign, Error> {
    env.storage()
        .persistent()
        .get(&campaign_key(env, id))
        .ok_or(Error::AirdropNotFound)
}

pub fn has_claimed(env: &Env, campaign_id: u32, claimer: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&claimed_key(env, campaign_id, claimer))
}

pub fn mark_claimed(env: &Env, campaign_id: u32, claimer: &Address) {
    env.storage()
        .persistent()
        .set(&claimed_key(env, campaign_id, claimer), &true);
}

pub fn is_allowlisted(env: &Env, campaign_id: u32, addr: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&allowlist_key(campaign_id, addr))
}

pub fn add_to_allowlist(env: &Env, campaign_id: u32, addr: &Address) {
    env.storage()
        .persistent()
        .set(&allowlist_key(campaign_id, addr), &true);
}

pub fn remove_from_allowlist(env: &Env, campaign_id: u32, addr: &Address) {
    env.storage()
        .persistent()
        .remove(&allowlist_key(campaign_id, addr));
}
