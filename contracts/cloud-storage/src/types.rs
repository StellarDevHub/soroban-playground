use soroban_sdk::{contracterror, contracttype, Address, String, Vec, Map};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    FileNotFound = 3,
    Unauthorized = 4,
    ContractPaused = 5,
    InsufficientReplicas = 6,
    ShardNotFound = 7,
    InvalidShardCount = 8,
    AccessDenied = 9,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FileMetadata {
    pub owner: Address,
    pub name: String,
    pub size: u64,
    pub shard_count: u32,
    pub cid: String, // Content Identifier
    pub redundancy_level: u32, // Number of replicas per shard
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShardMetadata {
    pub shard_id: u32,
    pub hash: String, // Hash of the shard data
    pub size: u64,
    pub replicas: Vec<Address>, // Providers storing this shard
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StorageOffer {
    pub provider: Address,
    pub capacity: u64,
    pub price_per_gb: i128,
    pub available: u64, // Available capacity
}
