use soroban_sdk::{contracttype, Address, Env, String, Vec, Map};
use crate::types::{FileMetadata, StorageOffer, ShardMetadata};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    Paused,
    File(String), // By CID
    Shard(String, u32), // (CID, shard_id)
    AccessControl(String), // By CID, Map<Address, bool>
    Offer(Address),
    TotalStorage,
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_file(env: &Env, cid: String) -> Option<FileMetadata> {
    env.storage().persistent().get(&DataKey::File(cid))
}

pub fn set_file(env: &Env, cid: String, meta: &FileMetadata) {
    env.storage().persistent().set(&DataKey::File(cid), meta);
}

pub fn get_shard(env: &Env, cid: String, shard_id: u32) -> Option<ShardMetadata> {
    env.storage().persistent().get(&DataKey::Shard(cid, shard_id))
}

pub fn set_shard(env: &Env, cid: String, shard_id: u32, shard: &ShardMetadata) {
    env.storage().persistent().set(&DataKey::Shard(cid, shard_id), shard);
}

pub fn get_access_control(env: &Env, cid: String) -> Map<Address, bool> {
    env.storage().persistent().get(&DataKey::AccessControl(cid)).unwrap_or(Map::new(env))
}

pub fn set_access_control(env: &Env, cid: String, access: &Map<Address, bool>) {
    env.storage().persistent().set(&DataKey::AccessControl(cid), access);
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

pub fn remove_storage(env: &Env, amount: u64) {
    let total = get_total_storage(env);
    if total >= amount {
        env.storage().instance().set(&DataKey::TotalStorage, &(total - amount));
    }
}
