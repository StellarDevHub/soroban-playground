use soroban_sdk::{Address, Env};

use crate::types::{Error, InstanceKey, DataKey, StakeInfo, UnstakeRequest};

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_initialized(env: &Env, initialized: bool) {
    env.storage().instance().set(&InstanceKey::Initialized, &initialized);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Initialized)
        .unwrap_or(false)
}

pub fn set_token(env: &Env, token: &Address) {
    env.storage().instance().set(&InstanceKey::Token, token);
}

pub fn get_token(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Token)
        .ok_or(Error::NotInitialized)
}

pub fn set_total_staked(env: &Env, total: i128) {
    env.storage().instance().set(&InstanceKey::TotalStaked, &total);
}

pub fn get_total_staked(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalStaked)
        .unwrap_or(0)
}

pub fn set_total_shares(env: &Env, total: i128) {
    env.storage().instance().set(&InstanceKey::TotalShares, &total);
}

pub fn get_total_shares(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalShares)
        .unwrap_or(0)
}

pub fn set_unstake_period(env: &Env, period: u64) {
    env.storage().instance().set(&InstanceKey::UnstakePeriod, &period);
}

pub fn get_unstake_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::UnstakePeriod)
        .unwrap_or(604800) // 7 days in seconds
}

pub fn set_stake(env: &Env, owner: &Address, stake: &StakeInfo) {
    env.storage().persistent().set(&DataKey::Stake(owner.clone()), stake);
}

pub fn get_stake(env: &Env, owner: &Address) -> Option<StakeInfo> {
    env.storage().persistent().get(&DataKey::Stake(owner.clone()))
}

pub fn get_unstake_count(env: &Env, owner: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::UnstakeCount(owner.clone()))
        .unwrap_or(0)
}

pub fn set_unstake_count(env: &Env, owner: &Address, count: u32) {
    env.storage().persistent().set(&DataKey::UnstakeCount(owner.clone()), &count);
}

pub fn set_unstake_request(env: &Env, owner: &Address, idx: u32, request: &UnstakeRequest) {
    env.storage().persistent().set(&DataKey::Unstake(owner.clone(), idx), request);
}

pub fn get_unstake_request(env: &Env, owner: &Address, idx: u32) -> Option<UnstakeRequest> {
    env.storage().persistent().get(&DataKey::Unstake(owner.clone(), idx))
}
