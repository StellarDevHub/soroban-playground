use soroban_sdk::{Address, Env};

use crate::types::{AirdropInfo, DataKey, Error, InstanceKey};

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
    env.storage()
        .instance()
        .set(&InstanceKey::Initialized, &initialized);
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Initialized)
        .unwrap_or(false)
}

pub fn set_airdrop_info(env: &Env, info: &AirdropInfo) {
    env.storage().instance().set(&InstanceKey::AirdropInfo, info);
}

pub fn get_airdrop_info(env: &Env) -> Result<AirdropInfo, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::AirdropInfo)
        .ok_or(Error::NotInitialized)
}

pub fn set_claimed(env: &Env, address: &Address, claimed: bool) {
    env.storage()
        .persistent()
        .set(&DataKey::Claimed(address.clone()), &claimed);
}

pub fn is_claimed(env: &Env, address: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Claimed(address.clone()))
        .unwrap_or(false)
}
