// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Decentralized Warranty Management
//!
//! - Product registration: admin registers products with default warranty duration.
//! - Warranty issuance: admin issues warranties to product owners.
//! - Claim filing: owners file claims against active, non-expired warranties.
//! - Claim processing: admin approves or rejects claims (automated by status update).
//! - Emergency pause/unpause.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_claim, get_claim_count, get_product, get_product_count, get_warranty,
    get_warranty_count, is_initialized, is_paused, set_admin, set_claim, set_claim_count,
    set_paused, set_product, set_product_count, set_warranty, set_warranty_count,
};
use crate::types::{Claim, ClaimStatus, Error, Product, Warranty};

#[contract]
pub struct WarrantyContract;

#[contractimpl]
impl WarrantyContract {
    // ── Init ──────────────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) { return Err(Error::AlreadyInitialized); }
        admin.require_auth();
        set_admin(&env, &admin);
        set_product_count(&env, 0);
        set_warranty_count(&env, 0);
        set_claim_count(&env, 0);
        set_paused(&env, false);
        env.events().publish((symbol_short!("init"),), admin);
        Ok(())
    }

    // ── Admin: products ───────────────────────────────────────────────────────

    /// Register a product. Returns product ID.
    pub fn register_product(
        env: Env,
        admin: Address,
        name: String,
        manufacturer: Address,
        default_warranty_secs: u64,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        if name.len() == 0 { return Err(Error::EmptyField); }
        if default_warranty_secs == 0 { return Err(Error::InvalidDuration); }
        let id = get_product_count(&env) + 1;
        set_product(&env, id, &Product { name, manufacturer, default_warranty_secs, is_active: true });
        set_product_count(&env, id);
        env.events().publish((symbol_short!("prod_reg"), id), default_warranty_secs);
        Ok(id)
    }

    /// Deactivate a product (no new warranties).
    pub fn deactivate_product(env: Env, admin: Address, product_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut p = get_product(&env, product_id)?;
        p.is_active = false;
        set_product(&env, product_id, &p);
        Ok(())
    }

    // ── Admin: warranties ─────────────────────────────────────────────────────

    /// Issue a warranty to an owner. Uses product's default duration. Returns warranty ID.
    pub fn issue_warranty(
        env: Env,
        admin: Address,
        product_id: u32,
        owner: Address,
    ) -> Result<u32, Error> {
        Self::assert_admin(&env, &admin)?;
        let product = get_product(&env, product_id)?;
        if !product.is_active { return Err(Error::WarrantyInactive); }
        let now = env.ledger().timestamp();
        let id = get_warranty_count(&env) + 1;
        set_warranty(&env, id, &Warranty {
            product_id,
            owner: owner.clone(),
            issued_at: now,
            expires_at: now + product.default_warranty_secs,
            is_active: true,
        });
        set_warranty_count(&env, id);
        env.events().publish((symbol_short!("warr_iss"), id), (owner, product_id));
        Ok(id)
    }

    /// Void a warranty (admin only).
    pub fn void_warranty(env: Env, admin: Address, warranty_id: u32) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut w = get_warranty(&env, warranty_id)?;
        w.is_active = false;
        set_warranty(&env, warranty_id, &w);
        env.events().publish((symbol_short!("warr_void"), warranty_id), ());
        Ok(())
    }

    // ── User: claims ──────────────────────────────────────────────────────────

    /// File a claim against an active, non-expired warranty. Returns claim ID.
    pub fn file_claim(
        env: Env,
        claimant: Address,
        warranty_id: u32,
        description: String,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        claimant.require_auth();
        if description.len() == 0 { return Err(Error::EmptyField); }

        let warranty = get_warranty(&env, warranty_id)?;
        if !warranty.is_active { return Err(Error::WarrantyInactive); }
        if env.ledger().timestamp() > warranty.expires_at { return Err(Error::WarrantyExpired); }

        let id = get_claim_count(&env) + 1;
        set_claim(&env, id, &Claim {
            warranty_id,
            claimant: claimant.clone(),
            description,
            filed_at: env.ledger().timestamp(),
            status: ClaimStatus::Pending,
        });
        set_claim_count(&env, id);
        env.events().publish((symbol_short!("claim_new"), id), (claimant, warranty_id));
        Ok(id)
    }

    /// Process a claim: approve or reject (admin only).
    pub fn process_claim(
        env: Env,
        admin: Address,
        claim_id: u32,
        approve: bool,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        let mut claim = get_claim(&env, claim_id)?;
        if claim.status != ClaimStatus::Pending { return Err(Error::ClaimAlreadyProcessed); }
        claim.status = if approve { ClaimStatus::Approved } else { ClaimStatus::Rejected };
        set_claim(&env, claim_id, &claim);
        env.events().publish((symbol_short!("claim_proc"), claim_id), approve);
        Ok(())
    }

    // ── Admin: pause ──────────────────────────────────────────────────────────

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    pub fn get_product(env: Env, product_id: u32) -> Result<Product, Error> { get_product(&env, product_id) }
    pub fn get_warranty(env: Env, warranty_id: u32) -> Result<Warranty, Error> { get_warranty(&env, warranty_id) }
    pub fn get_claim(env: Env, claim_id: u32) -> Result<Claim, Error> { get_claim(&env, claim_id) }
    pub fn product_count(env: Env) -> u32 { get_product_count(&env) }
    pub fn warranty_count(env: Env) -> u32 { get_warranty_count(&env) }
    pub fn claim_count(env: Env) -> u32 { get_claim_count(&env) }
    pub fn is_initialized(env: Env) -> bool { is_initialized(&env) }
    pub fn is_paused(env: Env) -> bool { is_paused(&env) }
    pub fn get_admin(env: Env) -> Result<Address, Error> { get_admin(&env) }

    /// Returns true if the warranty is active and not expired.
    pub fn is_warranty_valid(env: Env, warranty_id: u32) -> Result<bool, Error> {
        let w = get_warranty(&env, warranty_id)?;
        Ok(w.is_active && env.ledger().timestamp() <= w.expires_at)
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) { return Err(Error::NotInitialized); }
        Ok(())
    }
    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) { return Err(Error::ContractPaused); }
        Ok(())
    }
    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        if *caller != get_admin(env)? { return Err(Error::Unauthorized); }
        Ok(())
    }
}
