// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Address, Env};

use crate::types::{DataSource, Error, ProvenanceEvent, Shipment};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&soroban_sdk::symbol_short!("INIT"))
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("INIT"), &true);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&soroban_sdk::symbol_short!("ADMIN")).ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("ADMIN"), admin);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage().instance().get(&soroban_sdk::symbol_short!("PAUSED")).unwrap_or(false)
}

pub fn set_paused(env: &Env, v: bool) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("PAUSED"), &v);
}

pub fn get_shipment_count(env: &Env) -> u32 {
    env.storage().instance().get(&soroban_sdk::symbol_short!("SCOUNT")).unwrap_or(0u32)
}

pub fn set_shipment_count(env: &Env, n: u32) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("SCOUNT"), &n);
}

pub fn get_threshold(env: &Env) -> u32 {
    env.storage().instance().get(&soroban_sdk::symbol_short!("THRESH")).unwrap_or(2u32)
}

pub fn set_threshold(env: &Env, t: u32) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("THRESH"), &t);
}

pub fn is_circuit_breaker_active(env: &Env) -> bool {
    env.storage().instance().get(&soroban_sdk::symbol_short!("CB")).unwrap_or(false)
}

pub fn set_circuit_breaker(env: &Env, v: bool) {
    env.storage().instance().set(&soroban_sdk::symbol_short!("CB"), &v);
}

pub fn get_shipment(env: &Env, id: u32) -> Result<Shipment, Error> {
    env.storage()
        .persistent()
        .get(&(soroban_sdk::symbol_short!("SHIP"), id))
        .ok_or(Error::ShipmentNotFound)
}

pub fn set_shipment(env: &Env, s: &Shipment) {
    env.storage().persistent().set(&(soroban_sdk::symbol_short!("SHIP"), s.id), s);
}

pub fn get_prov_count(env: &Env, shipment_id: u32) -> u32 {
    env.storage()
        .persistent()
        .get(&(soroban_sdk::symbol_short!("PCNT"), shipment_id))
        .unwrap_or(0u32)
}

pub fn set_prov_count(env: &Env, shipment_id: u32, n: u32) {
    env.storage().persistent().set(&(soroban_sdk::symbol_short!("PCNT"), shipment_id), &n);
}

pub fn get_prov_event(env: &Env, shipment_id: u32, index: u32) -> Option<ProvenanceEvent> {
    env.storage()
        .persistent()
        .get(&(soroban_sdk::symbol_short!("PROV"), shipment_id, index))
}

pub fn set_prov_event(env: &Env, event: &ProvenanceEvent) {
    env.storage()
        .persistent()
        .set(&(soroban_sdk::symbol_short!("PROV"), event.shipment_id, event.index), event);
}

pub fn get_source(env: &Env, addr: &Address) -> Option<DataSource> {
    env.storage().persistent().get(&(soroban_sdk::symbol_short!("SRC"), addr.clone()))
}

pub fn set_source(env: &Env, ds: &DataSource) {
    env.storage().persistent().set(&(soroban_sdk::symbol_short!("SRC"), ds.address.clone()), ds);
}

pub fn source_exists(env: &Env, addr: &Address) -> bool {
    env.storage().persistent().has(&(soroban_sdk::symbol_short!("SRC"), addr.clone()))
}
