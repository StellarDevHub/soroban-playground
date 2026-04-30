use soroban_sdk::{contracttype, Address, Env, String};
use crate::types::{Song, UsageRecord, License, RevenueShare};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    Song(String),
    UsageRecord(String, Address), // (song_id, licensee)
    License(String, Address),      // (song_id, licensee)
    RevenueShare(String),          // song_id
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_song(env: &Env, id: String) -> Option<Song> {
    env.storage().persistent().get(&DataKey::Song(id))
}

pub fn set_song(env: &Env, id: String, song: &Song) {
    env.storage().persistent().set(&DataKey::Song(id), song);
}

// ── Usage Tracking ────────────────────────────────────────────────────────────

pub fn get_usage_record(env: &Env, song_id: String, licensee: Address) -> Option<UsageRecord> {
    env.storage().persistent().get(&DataKey::UsageRecord(song_id, licensee))
}

pub fn set_usage_record(env: &Env, song_id: String, licensee: Address, record: &UsageRecord) {
    env.storage().persistent().set(&DataKey::UsageRecord(song_id, licensee), record);
}

// ── License Management ────────────────────────────────────────────────────────

pub fn get_license(env: &Env, song_id: String, licensee: Address) -> Option<License> {
    env.storage().persistent().get(&DataKey::License(song_id, licensee))
}

pub fn set_license(env: &Env, song_id: String, licensee: Address, license: &License) {
    env.storage().persistent().set(&DataKey::License(song_id, licensee), license);
}

// ── Revenue Sharing ──────────────────────────────────────────────────────────

pub fn get_revenue_share(env: &Env, song_id: String) -> Option<RevenueShare> {
    env.storage().persistent().get(&DataKey::RevenueShare(song_id))
}

pub fn set_revenue_share(env: &Env, song_id: String, share: &RevenueShare) {
    env.storage().persistent().set(&DataKey::RevenueShare(song_id), share);
}
