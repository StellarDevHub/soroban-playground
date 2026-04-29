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

pub fn get_patent_count(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::PatentCount).unwrap_or(0)
}

pub fn set_patent_count(env: &Env, count: u32) {
    env.storage().instance().set(&InstanceKey::PatentCount, &count);
}

pub fn get_offer_count(env: &Env) -> u32 {
    env.storage().instance().get(&InstanceKey::OfferCount).unwrap_or(0)
}

pub fn set_offer_count(env: &Env, count: u32) {
    env.storage().instance().set(&InstanceKey::OfferCount, &count);
}

pub fn set_patent(env: &Env, patent: &Patent) {
    env.storage().persistent().set(&DataKey::Patent(patent.id), patent);
}

pub fn get_patent(env: &Env, patent_id: u32) -> Result<Patent, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Patent(patent_id))
        .ok_or(Error::PatentNotFound)
}

pub fn set_offer(env: &Env, offer: &LicenseOffer) {
    env.storage().persistent().set(&DataKey::Offer(offer.id), offer);
}

pub fn get_offer(env: &Env, offer_id: u32) -> Result<LicenseOffer, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Offer(offer_id))
        .ok_or(Error::LicenseOfferNotFound)
}
