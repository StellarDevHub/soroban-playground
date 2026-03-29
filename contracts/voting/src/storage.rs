use soroban_sdk::{Address, Env, Symbol, Vec};

use crate::types::{DataKey, Error, InstanceKey};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_options(env: &Env, options: &Vec<Symbol>) {
    env.storage().instance().set(&InstanceKey::Options, options);
}

pub fn get_options(env: &Env) -> Result<Vec<Symbol>, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Options)
        .ok_or(Error::NotInitialized)
}

pub fn set_total_voters(env: &Env, total_voters: u32) {
    env.storage()
        .instance()
        .set(&InstanceKey::TotalVoters, &total_voters);
}

pub fn get_total_voters(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalVoters)
        .unwrap_or(0)
}

pub fn increment_total_voters(env: &Env) {
    let total_voters = get_total_voters(env);
    set_total_voters(env, total_voters + 1);
}

pub fn set_vote(env: &Env, voter: &Address, option: &Symbol) {
    env.storage()
        .persistent()
        .set(&DataKey::Vote(voter.clone()), option);
}

pub fn get_vote(env: &Env, voter: &Address) -> Option<Symbol> {
    env.storage()
        .persistent()
        .get(&DataKey::Vote(voter.clone()))
}

pub fn has_vote(env: &Env, voter: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Vote(voter.clone()))
}

pub fn set_count(env: &Env, option: &Symbol, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::Count(option.clone()), &count);
}

pub fn get_count(env: &Env, option: &Symbol) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::Count(option.clone()))
        .unwrap_or(0)
}

pub fn is_registered_option(env: &Env, option: &Symbol) -> Result<bool, Error> {
    let options = get_options(env)?;

    for index in 0..options.len() {
        if options.get(index).unwrap() == *option {
            return Ok(true);
        }
    }

    Ok(false)
}
