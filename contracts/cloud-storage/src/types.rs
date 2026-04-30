use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    FileNotFound = 3,
    Unauthorized = 4,
    Paused = 5,
    ProviderNotFound = 6,
    FileNotOwnedByCaller = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileMetadata {
    pub owner: Address,
    pub name: String,
    pub size: u64,
    pub shard_count: u32,
    pub cid: String,
    pub redundancy_factor: u32,
    pub shards_manifest_cid: String,
    pub uploaded_at: u64,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageProvider {
    pub provider: Address,
    pub capacity: u64,
    pub used_capacity: u64,
    pub price_per_gb: i128,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageOffer {
    pub provider: Address,
    pub capacity: u64,
    pub price_per_gb: i128,
}
