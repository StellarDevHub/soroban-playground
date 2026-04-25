use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    FileNotFound = 3,
    Unauthorized = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileMetadata {
    pub owner: Address,
    pub name: String,
    pub size: u64,
    pub shard_count: u32,
    pub cid: String, // Content Identifier
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageOffer {
    pub provider: Address,
    pub capacity: u64,
    pub price_per_gb: i128,
}
