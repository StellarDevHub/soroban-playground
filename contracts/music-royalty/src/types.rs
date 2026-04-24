use soroban_sdk::{contracterror, contracttype, Address, String, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    SongNotFound = 3,
    InvalidSplits = 4,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Split {
    pub account: Address,
    pub share: u32, // In basis points (1/10000)
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist: Address,
    pub splits: Vec<Split>,
    pub total_royalty_earned: i128,
}
