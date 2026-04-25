#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, String};
use crate::storage::{
    add_storage, get_file, get_offer, get_total_storage, is_initialized, 
    set_file, set_initialized, set_offer
};
use crate::types::{Error, FileMetadata, StorageOffer};

#[contract]
pub struct CloudStorage;

#[contractimpl]
impl CloudStorage {
    pub fn initialize(env: Env) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_initialized(&env);
        Ok(())
    }

    pub fn upload_file(
        env: Env,
        owner: Address,
        name: String,
        size: u64,
        shard_count: u32,
        cid: String,
    ) -> Result<(), Error> {
        owner.require_auth();
        
        let meta = FileMetadata {
            owner,
            name,
            size,
            shard_count,
            cid: cid.clone(),
        };

        set_file(&env, cid, &meta);
        Ok(())
    }

    pub fn create_offer(
        env: Env,
        provider: Address,
        capacity: u64,
        price_per_gb: i128,
    ) -> Result<(), Error> {
        provider.require_auth();
        
        let offer = StorageOffer {
            provider: provider.clone(),
            capacity,
            price_per_gb,
        };

        set_offer(&env, provider, &offer);
        add_storage(&env, capacity);
        Ok(())
    }

    pub fn get_file_info(env: Env, cid: String) -> Result<FileMetadata, Error> {
        get_file(&env, cid).ok_or(Error::FileNotFound)
    }

    pub fn get_total_capacity(env: Env) -> u64 {
        get_total_storage(&env)
    }
}
