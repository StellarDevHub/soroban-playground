use soroban_sdk::{contracttype, Address, Env, String};
use crate::types::{FileMetadata, StorageOffer, StorageProvider};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    File(String), // By CID
    Offer(Address),
    TotalStorage,
    Paused,
    ProviderCounter,
    Providers(u32), // Index-based storage for iteration
    ProviderByAddress(Address), // Maps Address -> u32 (index)
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

// Pause management
pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

// Provider management
pub fn get_provider(env: &Env, provider: Address) -> Option<StorageProvider> {
    // Look up the provider's index first
    let index: u32 = env.storage().persistent().get(&DataKey::ProviderByAddress(provider.clone()))?;
    // Then get the provider data by index
    env.storage().persistent().get(&DataKey::Providers(index))
}

pub fn set_provider(env: &Env, provider: Address, data: &StorageProvider) {
    let index: u32;
    let new_provider = data.provider == provider;

    if new_provider {
        // Get next available index
        let counter: u32 = env.storage().instance().get(&DataKey::ProviderCounter).unwrap_or(0);
        index = counter;
        env.storage().instance().set(&DataKey::ProviderCounter, &(counter + 1));
    } else {
        // Updating existing provider, get their index
        index = env.storage().persistent()
            .get(&DataKey::ProviderByAddress(provider.clone()))
            .expect("Provider not found");
    }

    // Store provider data by index
    env.storage().persistent().set(&DataKey::Providers(index), data);

    // Always update the address -> index mapping for the provider stored in data
    env.storage().persistent().set(&DataKey::ProviderByAddress(data.provider.clone()), &index);
}

pub fn get_all_provider_ids(env: &Env) -> Vec<Address> {
    let counter: u32 = env.storage().instance().get(&DataKey::ProviderCounter).unwrap_or(0);
    let mut ids = Vec::new(env);
    for i in 0..counter {
        if let Some(provider) = env.storage().persistent().get::<StorageProvider>(&DataKey::Providers(i)) {
            if provider.is_active {
                ids.push_back(provider.provider);
            }
        }
    }
    ids
}
