use soroban_sdk::{Address, Env, Symbol};

use crate::types::{Error, VestingSchedule};

const ADMIN_KEY: &str = "admin";
const COUNT_KEY: &str = "count";

fn schedule_key(env: &Env, id: u32) -> Symbol {
    Symbol::new(env, &format!("vs_{}", id))
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

pub fn save_schedule(env: &Env, s: &VestingSchedule) {
    env.storage().persistent().set(&schedule_key(env, s.id), s);
}

pub fn load_schedule(env: &Env, id: u32) -> Result<VestingSchedule, Error> {
    env.storage()
        .persistent()
        .get(&schedule_key(env, id))
        .ok_or(Error::ScheduleNotFound)
}
