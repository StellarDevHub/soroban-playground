#![no_std]

mod storage;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, String, Symbol};
use crate::storage::{
    add_storage, get_file, get_offer, get_provider, get_total_storage, 
    is_initialized, is_paused, set_file, set_initialized, set_offer, set_provider,
    get_all_provider_ids
};
use crate::types::{Error, FileMetadata, StorageOffer, StorageProvider};

#[contract]
pub struct CloudStorage;

#[contractimpl]
impl CloudStorage {
    pub fn initialize(env: Env) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        set_initialized(&env);
        env.events().publish((Symbol::new(&env, "initialize"),));
        Ok(())
    }

    pub fn set_paused(env: Env, caller: Address, paused: bool) -> Result<(), Error> {
        caller.require_auth();
        if is_paused(&env) != paused {
            set_paused(&env, paused);
            env.events().publish((Symbol::new(&env, "paused"), paused));
        }
        Ok(())
    }

    pub fn register_storage_provider(
        env: Env,
        provider: Address,
        capacity: u64,
        price_per_gb: i128,
    ) -> Result<(), Error> {
        provider.require_auth();

        if is_paused(&env) {
            return Err(Error::Paused);
        }

        let storage_provider = StorageProvider {
            provider: provider.clone(),
            capacity,
            used_capacity: 0,
            price_per_gb,
            is_active: true,
        };

        set_provider(&env, provider, &storage_provider);
        env.events().publish((
            Symbol::new(&env, "provider_registered"),
            provider,
            capacity,
            price_per_gb,
        ));
        Ok(())
    }

    pub fn remove_storage_provider(env: Env, provider: Address) -> Result<(), Error> {
        provider.require_auth();

        if is_paused(&env) {
            return Err(Error::Paused);
        }

        let mut storage_provider = get_provider(&env, provider).ok_or(Error::ProviderNotFound)?;
        storage_provider.is_active = false;
        set_provider(&env, provider.clone(), &storage_provider);

        env.events().publish((
            Symbol::new(&env, "provider_removed"),
            provider,
        ));
        Ok(())
    }

    pub fn upload_file(
        env: Env,
        owner: Address,
        name: String,
        size: u64,
        shard_count: u32,
        redundancy_factor: u32,
        cid: String,
        shards_manifest_cid: String,
    ) -> Result<(), Error> {
        owner.require_auth();

        if is_paused(&env) {
            return Err(Error::Paused);
        }

        let uploaded_at = env.ledger().timestamp();

        let meta = FileMetadata {
            owner: owner.clone(),
            name,
            size,
            shard_count,
            redundancy_factor,
            cid: cid.clone(),
            shards_manifest_cid,
            uploaded_at,
            is_active: true,
        };

        set_file(&env, cid, &meta);
        env.events().publish((
            Symbol::new(&env, "file_uploaded"),
            owner,
            cid,
            size,
            uploaded_at,
        ));
        Ok(())
    }

    pub fn update_file_metadata(
        env: Env,
        caller: Address,
        cid: String,
        new_shard_count: Option<u32>,
        new_redundancy_factor: Option<u32>,
    ) -> Result<(), Error> {
        caller.require_auth();

        if is_paused(&env) {
            return Err(Error::Paused);
        }

        let mut meta = get_file(&env, cid.clone()).ok_or(Error::FileNotFound)?;

        if meta.owner != caller {
            return Err(Error::FileNotOwnedByCaller);
        }

        if let Some(shard_count) = new_shard_count {
            meta.shard_count = shard_count;
        }
        if let Some(redundancy_factor) = new_redundancy_factor {
            meta.redundancy_factor = redundancy_factor;
        }

        set_file(&env, cid, &meta);
        env.events().publish((
            Symbol::new(&env, "file_updated"),
            caller,
            cid,
        ));
        Ok(())
    }

    pub fn delete_file_metadata(
        env: Env,
        caller: Address,
        cid: String,
    ) -> Result<(), Error> {
        caller.require_auth();

        if is_paused(&env) {
            return Err(Error::Paused);
        }

        let meta = get_file(&env, cid.clone()).ok_or(Error::FileNotFound)?;

        if meta.owner != caller {
            return Err(Error::FileNotOwnedByCaller);
        }

        // Mark as inactive instead of deleting to preserve history
        let mut meta = meta;
        meta.is_active = false;

        env.events().publish((
            Symbol::new(&env, "file_deleted"),
            caller,
            cid,
        ));
        Ok(())
    }

    pub fn get_storage_provider(env: Env, provider: Address) -> Result<StorageProvider, Error> {
        get_provider(&env, provider).ok_or(Error::ProviderNotFound)
    }

    pub fn get_all_active_providers(env: Env) -> Vec<StorageProvider> {
        let active_providers = Vec::new(&env);
        let all_ids = get_all_provider_ids(&env);

        for id in all_ids.iter() {
            if let Some(provider) = get_provider(&env, id) {
                if provider.is_active {
                    active_providers.push_back(provider);
                }
            }
        }
        active_providers
    }

    pub fn get_file_info(env: Env, cid: String) -> Result<FileMetadata, Error> {
        get_file(&env, cid).ok_or(Error::FileNotFound)
    }

    pub fn get_total_capacity(env: Env) -> u64 {
        get_total_storage(&env)
    }
}
