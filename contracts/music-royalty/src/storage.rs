use soroban_sdk::{contracttype, Address, Env, String};
use crate::types::Song;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    Song(String),
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
