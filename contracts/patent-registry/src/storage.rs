use soroban_sdk::{Address, Env};

use crate::types::{DataKey, Error, InstanceKey, LicenseOffer, Patent};

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

pub fn set_verifier(env: &Env, verifier: &Address) {
    env.storage().instance().set(&InstanceKey::Verifier, verifier);
}

pub fn get_verifier(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&InstanceKey::Verifier)
        .ok_or(Error::NotInitialized)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&InstanceKey::Paused).unwrap_or(false)
}

pub fn patent_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::PatentCount)
        .unwrap_or(0)
}

pub fn set_patent_count(env: &Env, count: u32) {
    env.storage().instance().set(&InstanceKey::PatentCount, &count);
}

pub fn license_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&InstanceKey::LicenseCount)
        .unwrap_or(0)
}

pub fn set_license_count(env: &Env, count: u32) {
    env.storage().instance().set(&InstanceKey::LicenseCount, &count);
}

pub fn set_patent(env: &Env, id: u32, patent: &Patent) {
    env.storage().persistent().set(&DataKey::Patent(id), patent);
}

pub fn get_patent(env: &Env, id: u32) -> Result<Patent, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Patent(id))
        .ok_or(Error::PatentNotFound)
}

pub fn has_patent(env: &Env, id: u32) -> bool {
    env.storage().persistent().has(&DataKey::Patent(id))
}

pub fn set_license(env: &Env, id: u32, offer: &LicenseOffer) {
    env.storage().persistent().set(&DataKey::License(id), offer);
}

pub fn get_license(env: &Env, id: u32) -> Result<LicenseOffer, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::License(id))
        .ok_or(Error::LicenseNotFound)
}

pub fn has_license(env: &Env, id: u32) -> bool {
    env.storage().persistent().has(&DataKey::License(id))
}
