// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String};

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ShipmentStatus {
    Created,
    InTransit,
    CustomsHold,
    Delivered,
    Disputed,
    Finalized,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Shipment {
    pub id: u32,
    pub shipment_ref: String,
    pub origin: String,
    pub destination: String,
    pub owner: Address,
    pub status: ShipmentStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub confirmations: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ProvenanceEvent {
    pub shipment_id: u32,
    pub index: u32,
    pub event_type: String,
    pub location: String,
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
    ShipmentNotFound = 8,
    ShipmentAlreadyFinalized = 9,
    InvalidThreshold = 10,
    CircuitBreakerActive = 11,
    InvalidShipmentRef = 12,
    InvalidStatusTransition = 13,
}
