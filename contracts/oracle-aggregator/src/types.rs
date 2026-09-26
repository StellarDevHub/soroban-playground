use soroban_sdk::{contract, Address, String};

#[derive(Clone)]
#[contract]
pub struct OraclePrice {
    pub asset_id: String,
    pub median: i128,
    pub deviation: i128,
    pub age_seconds: u64,
    pub reporter_count: u32,
}

#[derive(Clone)]
#[contract]
pub struct Reporter {
    pub address: Address,
    pub active: bool,
    pub submissions: u32,
}

#[derive(Clone)]
#[contract]
pub enum DataKey {
    Price(String),
    Reporters,
    ReporterAssets(Address),
    Admin,
    MaxPriceAge,
    MinReporterQuorum,
    PriceHistory((String, u32)),
}

#[derive(Clone, Copy, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    NotInitialized = 2,
    AlreadyInitialized = 3,
    AssetNotSupported = 4,
    ReporterInactive = 5,
    ReporterNotFound = 6,
    StalePrice = 7,
    InsufficientReporters = 8,
    InvalidPrice = 9,
}
