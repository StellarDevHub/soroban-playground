// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use crate::types::{Error, EscrowRecord, NFTRecord, RentalListing};
use soroban_sdk::{contracttype, Address, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Initialized,
    Token(u64),
    Listing(u64),
    Escrow(u64),
    Balance(Address),
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Initialized)
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn get_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_nft(env: &Env, token_id: u64) -> Result<NFTRecord, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Token(token_id))
        .ok_or(Error::NFTNotFound)
}

pub fn set_nft(env: &Env, nft: &NFTRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Token(nft.token_id), nft);
}

pub fn remove_nft(env: &Env, token_id: u64) {
    env.storage().persistent().remove(&DataKey::Token(token_id));
}

pub fn get_listing(env: &Env, token_id: u64) -> Result<RentalListing, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Listing(token_id))
        .ok_or(Error::ListingNotFound)
}

pub fn set_listing(env: &Env, listing: &RentalListing) {
    env.storage()
        .persistent()
        .set(&DataKey::Listing(listing.token_id), listing);
}

pub fn remove_listing(env: &Env, token_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Listing(token_id));
}

pub fn get_escrow(env: &Env, token_id: u64) -> Result<EscrowRecord, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Escrow(token_id))
        .ok_or(Error::EscrowNotFound)
}

pub fn set_escrow(env: &Env, escrow: &EscrowRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Escrow(escrow.token_id), escrow);
}

pub fn remove_escrow(env: &Env, token_id: u64) {
    env.storage()
        .persistent()
        .remove(&DataKey::Escrow(token_id));
}

pub fn get_balance(env: &Env, account: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::Balance(account.clone()))
        .unwrap_or(0)
}

pub fn set_balance(env: &Env, account: &Address, amount: i128) {
    env.storage()
        .persistent()
        .set(&DataKey::Balance(account.clone()), &amount);
}
