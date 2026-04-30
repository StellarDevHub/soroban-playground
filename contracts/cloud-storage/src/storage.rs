use soroban_sdk::{contracttype, Address, Env, String};
use crate::types::{FileMetadata, StorageOffer};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    File(String), // By CID
    Offer(Address),
    TotalStorage,
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_file(env: &Env, cid: String) -> Option<FileMetadata> {
    env.storage().persistent().get(&DataKey::File(cid))
}

pub fn set_file(env: &Env, cid: String, meta: &FileMetadata) {
    env.storage().persistent().set(&DataKey::File(cid), meta);
}

pub fn get_offer(env: &Env, provider: Address) -> Option<StorageOffer> {
    env.storage().persistent().get(&DataKey::Offer(provider))
}

pub fn set_offer(env: &Env, provider: Address, offer: &StorageOffer) {
    env.storage().persistent().set(&DataKey::Offer(provider), offer);
}

pub fn get_total_storage(env: &Env) -> u64 {
    env.storage().instance().get(&DataKey::TotalStorage).unwrap_or(0)
}

pub fn add_storage(env: &Env, amount: u64) {
    let total = get_total_storage(env);
    env.storage().instance().set(&DataKey::TotalStorage, &(total + amount));
}
