#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec, Map, symbol_short, log, events};
use crate::storage::{
    add_storage, get_access_control, get_admin, get_file, get_offer, get_shard, get_total_storage, 
    is_initialized, is_paused, remove_storage, set_access_control, set_admin, set_file, 
    set_initialized, set_offer, set_paused, set_shard
};
use crate::types::{Error, FileMetadata, ShardMetadata, StorageOffer};

#[contract]
pub struct CloudStorage;

#[contractimpl]
impl CloudStorage {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_initialized(&env);
        set_admin(&env, &admin);
        set_paused(&env, false);
        events::publish(&env, symbol_short!("init"), admin);
        Ok(())
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        let admin = get_admin(&env).ok_or(Error::NotInitialized)?;
        admin.require_auth();
        set_paused(&env, true);
        events::publish(&env, symbol_short!("paused"), ());
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin = get_admin(&env).ok_or(Error::NotInitialized)?;
        admin.require_auth();
        set_paused(&env, false);
        events::publish(&env, symbol_short!("unpaused"), ());
        Ok(())
    }

    pub fn upload_file(
        env: Env,
        owner: Address,
        name: String,
        size: u64,
        shard_count: u32,
        redundancy_level: u32,
        cid: String,
    ) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if shard_count == 0 {
            return Err(Error::InvalidShardCount);
        }
        owner.require_auth();
        
        let meta = FileMetadata {
            owner: owner.clone(),
            name,
            size,
            shard_count,
            cid: cid.clone(),
            redundancy_level,
        };

        set_file(&env, cid.clone(), &meta);
        events::publish(&env, symbol_short!("file_upload"), (owner, cid));
        Ok(())
    }

    pub fn add_shard(
        env: Env,
        cid: String,
        shard_id: u32,
        hash: String,
        size: u64,
        provider: Address,
    ) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        let file = get_file(&env, cid.clone()).ok_or(Error::FileNotFound)?;
        if shard_id >= file.shard_count {
            return Err(Error::InvalidShardCount);
        }
        provider.require_auth();

        let mut shard = get_shard(&env, cid.clone(), shard_id).unwrap_or(ShardMetadata {
            shard_id,
            hash: String::from_str(&env, ""),
            size: 0,
            replicas: Vec::new(&env),
        });

        if shard.replicas.contains(&provider) {
            return Ok(()); // Already stored
        }

        shard.hash = hash;
        shard.size = size;
        shard.replicas.push_back(provider.clone());

        set_shard(&env, cid.clone(), shard_id, &shard);
        events::publish(&env, symbol_short!("shard_add"), (cid, shard_id, provider));
        Ok(())
    }

    pub fn grant_access(env: Env, cid: String, user: Address) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        let file = get_file(&env, cid.clone()).ok_or(Error::FileNotFound)?;
        file.owner.require_auth();

        let mut access = get_access_control(&env, cid.clone());
        access.set(user.clone(), true);
        set_access_control(&env, cid.clone(), &access);
        events::publish(&env, symbol_short!("access_grant"), (cid, user));
        Ok(())
    }

    pub fn revoke_access(env: Env, cid: String, user: Address) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        let file = get_file(&env, cid.clone()).ok_or(Error::FileNotFound)?;
        file.owner.require_auth();

        let mut access = get_access_control(&env, cid.clone());
        access.set(user.clone(), false);
        set_access_control(&env, cid.clone(), &access);
        events::publish(&env, symbol_short!("access_revoke"), (cid, user));
        Ok(())
    }

    pub fn create_offer(
        env: Env,
        provider: Address,
        capacity: u64,
        price_per_gb: i128,
    ) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        provider.require_auth();
        
        let offer = StorageOffer {
            provider: provider.clone(),
            capacity,
            price_per_gb,
            available: capacity,
        };

        set_offer(&env, provider.clone(), &offer);
        add_storage(&env, capacity);
        events::publish(&env, symbol_short!("offer_create"), provider);
        Ok(())
    }

    pub fn get_file_info(env: Env, cid: String) -> Result<FileMetadata, Error> {
        get_file(&env, cid).ok_or(Error::FileNotFound)
    }

    pub fn get_shard_info(env: Env, cid: String, shard_id: u32) -> Result<ShardMetadata, Error> {
        get_shard(&env, cid, shard_id).ok_or(Error::ShardNotFound)
    }

    pub fn check_access(env: Env, cid: String, user: Address) -> bool {
        let access = get_access_control(&env, cid);
        access.get(user).unwrap_or(false)
    }

    pub fn get_total_capacity(env: Env) -> u64 {
        get_total_storage(&env)
    }

    pub fn is_contract_paused(env: Env) -> bool {
        is_paused(&env)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Env as _};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register_contract(None, CloudStorage);
        let client = CloudStorageClient::new(&env, &contract_id);

        client.initialize(&admin);

        assert!(!client.is_contract_paused());
    }

    #[test]
    fn test_upload_file() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let owner = Address::generate(&env);

        let contract_id = env.register_contract(None, CloudStorage);
        let client = CloudStorageClient::new(&env, &contract_id);

        client.initialize(&admin);

        let cid = String::from_str(&env, "test-cid");
        client.upload_file(&owner, &String::from_str(&env, "test.txt"), &1000, &3, &3, &cid);

        let file_info = client.get_file_info(&cid);
        assert_eq!(file_info.owner, owner);
        assert_eq!(file_info.name, String::from_str(&env, "test.txt"));
    }

    #[test]
    fn test_pause_unpause() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register_contract(None, CloudStorage);
        let client = CloudStorageClient::new(&env, &contract_id);

        client.initialize(&admin);

        assert!(!client.is_contract_paused());

        client.pause();
        assert!(client.is_contract_paused());

        client.unpause();
        assert!(!client.is_contract_paused());
    }

    #[test]
    fn test_access_control() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let user = Address::generate(&env);

        let contract_id = env.register_contract(None, CloudStorage);
        let client = CloudStorageClient::new(&env, &contract_id);

        client.initialize(&admin);

        let cid = String::from_str(&env, "test-cid");
        client.upload_file(&owner, &String::from_str(&env, "test.txt"), &1000, &3, &3, &cid);

        assert!(!client.check_access(&cid, &user));

        client.grant_access(&cid, &user);
        assert!(client.check_access(&cid, &user));

        client.revoke_access(&cid, &user);
        assert!(!client.check_access(&cid, &user));
    }

    #[test]
    fn test_add_shard() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let provider = Address::generate(&env);

        let contract_id = env.register_contract(None, CloudStorage);
        let client = CloudStorageClient::new(&env, &contract_id);

        client.initialize(&admin);

        let cid = String::from_str(&env, "test-cid");
        client.upload_file(&owner, &String::from_str(&env, "test.txt"), &1000, &3, &3, &cid);

        let hash = String::from_str(&env, "shard-hash");
        client.add_shard(&cid, &0, &hash, &333, &provider);

        let shard_info = client.get_shard_info(&cid, &0);
        assert_eq!(shard_info.shard_id, 0);
        assert_eq!(shard_info.hash, hash);
        assert!(shard_info.replicas.contains(&provider));
    }
}
