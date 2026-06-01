// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum LogisticsStatus {
    InTransit,
    Delivered,
    Delayed,
    Verified,
    Finalized,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct LogisticsData {
    pub id: u32,
    pub shipment_id: String,
    pub origin: String,
    pub destination: String,
    pub carrier: String,
    pub status: LogisticsStatus,
    pub timestamp: u64,
    pub submitter: Address,
    pub confirmations: u32,
    pub temperature: i32,   // in tenths of °C, e.g. 250 = 25.0°C
    pub humidity: u32,      // percentage 0-100
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProvenanceRecord {
    pub shipment_id: String,
    pub data_id: u32,
    pub event: String,
    pub timestamp: u64,
    pub recorder: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DataSource {
    pub address: Address,
    pub name: String,
    pub active: bool,
    pub submissions: u32,
}

#[contracterror]
#[derive(Clone, Debug, PartialEq)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    ContractPaused = 4,
    SourceNotFound = 5,
    SourceAlreadyExists = 6,
    SourceInactive = 7,
    DataNotFound = 8,
    DataAlreadyFinalized = 9,
    InvalidThreshold = 10,
    CircuitBreakerActive = 11,
    InvalidShipmentId = 12,
    InvalidHumidity = 13,
}
