// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Decentralized Warranty Management
//!
//! A Soroban smart contract providing:
//! - Product registration by manufacturers.
//! - Warranty issuance to buyers with configurable duration.
//! - Claim filing by warranty owners.
//! - Claim resolution (approve/reject) by the admin or manufacturer.
//! - Emergency pause/unpause by admin.

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
pub struct WarrantyManagement;

#[contractimpl]
impl WarrantyManagement {
    // ── Initialisation ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.events().publish((symbol_short!("init"),), (admin,));
        Ok(())
    }

    // ── Emergency controls ────────────────────────────────────────────────────

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

    // ── Product registration ──────────────────────────────────────────────────

    /// Register a new product. Returns the product ID.
    pub fn register_product(
        env: Env,
        manufacturer: Address,
        name: String,
        warranty_duration_secs: u64,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        manufacturer.require_auth();
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if warranty_duration_secs == 0 {
            return Err(Error::InvalidDuration);
        }

        let id = get_product_count(&env) + 1;
        let product = Product {
            manufacturer: manufacturer.clone(),
            name: name.clone(),
            warranty_duration_secs,
            is_active: true,
        };
        set_product(&env, id, &product);
        set_product_count(&env, id);

        env.events()
            .publish((symbol_short!("prod_reg"), id), (manufacturer, name));
        Ok(id)
    }

    /// Deactivate a product (manufacturer or admin only).
    pub fn deactivate_product(env: Env, caller: Address, product_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        let mut product = get_product(&env, product_id)?;
        let admin = get_admin(&env)?;
        if caller != admin && caller != product.manufacturer {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        product.is_active = false;
        set_product(&env, product_id, &product);
        env.events()
            .publish((symbol_short!("prod_off"), product_id), ());
        Ok(())
    }

    // ── Warranty issuance ─────────────────────────────────────────────────────

    /// Issue a warranty to a buyer. Returns the warranty ID.
    /// Only the product's manufacturer (or admin) may issue warranties.
    pub fn issue_warranty(
        env: Env,
        issuer: Address,
        product_id: u32,
        owner: Address,
        serial_number: String,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        let product = get_product(&env, product_id)?;
        if !product.is_active {
            return Err(Error::ProductInactive);
        }
        let admin = get_admin(&env)?;
        if issuer != admin && issuer != product.manufacturer {
            return Err(Error::Unauthorized);
        }
        issuer.require_auth();

        let now = env.ledger().timestamp();
        let expiry_ts = now
            .checked_add(product.warranty_duration_secs)
            .ok_or(Error::InvalidDuration)?;
        let id = get_warranty_count(&env) + 1;
        let warranty = Warranty {
            product_id,
            owner: owner.clone(),
            purchase_ts: now,
            expiry_ts,
            is_active: true,
            serial_number: serial_number.clone(),
        };
        set_warranty(&env, id, &warranty);
        set_warranty_count(&env, id);

        env.events().publish(
            (symbol_short!("war_iss"), id),
            (owner, product_id, serial_number),
        );
        Ok(id)
    }

    // ── Claim management ──────────────────────────────────────────────────────

    /// File a warranty claim. Returns the claim ID.
    /// Enforces strict expiration check: `env.ledger().timestamp() <= warranty.expiry_ts`.
    pub fn file_claim(
        env: Env,
        claimant: Address,
        warranty_id: u32,
        description: String,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        claimant.require_auth();
        let warranty = get_warranty(&env, warranty_id)?;
        if warranty.owner != claimant {
            return Err(Error::NotWarrantyOwner);
        }
        if !warranty.is_active {
            return Err(Error::WarrantyInactive);
        }
        let now = env.ledger().timestamp();
        if now > warranty.expiry_ts {
            return Err(Error::WarrantyExpired);
        }

        let id = get_claim_count(&env) + 1;
        let claim = Claim {
            warranty_id,
            claimant: claimant.clone(),
            description: description.clone(),
            status: ClaimStatus::Filed,
            filed_ts: now,
            resolved_ts: 0,
            reimbursed_ts: 0,
        };
        set_claim(&env, id, &claim);
        set_claim_count(&env, id);

        env.events()
            .publish((symbol_short!("clm_fil"), id), (claimant, warranty_id));
        Ok(id)
    }

    /// Move a filed claim into review (`Filed -> InReview`). Admin or product manufacturer only.
    pub fn review_claim(env: Env, reviewer: Address, claim_id: u32) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        reviewer.require_auth();
        let mut claim = get_claim(&env, claim_id)?;
        if claim.status != ClaimStatus::Filed {
            return Err(Error::InvalidClaimTransition);
        }

        let warranty = get_warranty(&env, claim.warranty_id)?;
        let product = get_product(&env, warranty.product_id)?;
        Self::assert_admin_or_manufacturer(&env, &reviewer, &product.manufacturer)?;

        claim.status = ClaimStatus::InReview;
        set_claim(&env, claim_id, &claim);

        env.events()
            .publish((symbol_short!("clm_rev"), claim_id), (reviewer,));
        Ok(())
    }

    /// Resolve a claim in review (`InReview -> Approved | Rejected`).
    /// Admin or product manufacturer only.
    pub fn resolve_claim(
        env: Env,
        resolver: Address,
        claim_id: u32,
        approve: bool,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        resolver.require_auth();
        let mut claim = get_claim(&env, claim_id)?;
        match claim.status {
            ClaimStatus::InReview => {}
            ClaimStatus::Filed => return Err(Error::InvalidClaimTransition),
            ClaimStatus::Approved | ClaimStatus::Rejected | ClaimStatus::Reimbursed => {
                return Err(Error::ClaimAlreadyProcessed);
            }
        }

        // Verify resolver is admin or the product's manufacturer
        let warranty = get_warranty(&env, claim.warranty_id)?;
        let product = get_product(&env, warranty.product_id)?;
        Self::assert_admin_or_manufacturer(&env, &resolver, &product.manufacturer)?;

        claim.status = if approve {
            ClaimStatus::Approved
        } else {
            ClaimStatus::Rejected
        };
        claim.resolved_ts = env.ledger().timestamp();
        set_claim(&env, claim_id, &claim);

        let status_sym = if approve {
            symbol_short!("approved")
        } else {
            symbol_short!("rejected")
        };
        env.events()
            .publish((symbol_short!("clm_res"), claim_id), (status_sym,));
        Ok(())
    }

    /// Settle/reimburse an approved claim (`Approved -> Reimbursed`).
    /// If `full_replacement` is true, voids/burns the underlying warranty so no further claims
    /// can be filed against it. Admin or product manufacturer only.
    pub fn reimburse_claim(
        env: Env,
        settler: Address,
        claim_id: u32,
        full_replacement: bool,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        settler.require_auth();
        let mut claim = get_claim(&env, claim_id)?;
        match claim.status {
            ClaimStatus::Approved => {}
            ClaimStatus::Reimbursed => return Err(Error::ClaimAlreadyProcessed),
            ClaimStatus::Filed | ClaimStatus::InReview | ClaimStatus::Rejected => {
                return Err(Error::InvalidClaimTransition);
            }
        }

        let mut warranty = get_warranty(&env, claim.warranty_id)?;
        let product = get_product(&env, warranty.product_id)?;
        Self::assert_admin_or_manufacturer(&env, &settler, &product.manufacturer)?;

        claim.status = ClaimStatus::Reimbursed;
        claim.reimbursed_ts = env.ledger().timestamp();
        set_claim(&env, claim_id, &claim);

        if full_replacement {
            warranty.is_active = false;
            set_warranty(&env, claim.warranty_id, &warranty);
            env.events()
                .publish((symbol_short!("war_void"), claim.warranty_id), (claim_id,));
        }

        env.events()
            .publish((symbol_short!("clm_reim"), claim_id), (full_replacement,));
        Ok(())
    }

    // ── Read functions ────────────────────────────────────────────────────────

    pub fn get_product(env: Env, product_id: u32) -> Result<Product, Error> {
        get_product(&env, product_id)
    }

    pub fn get_warranty(env: Env, warranty_id: u32) -> Result<Warranty, Error> {
        get_warranty(&env, warranty_id)
    }

    pub fn get_claim(env: Env, claim_id: u32) -> Result<Claim, Error> {
        get_claim(&env, claim_id)
    }

    pub fn product_count(env: Env) -> u32 {
        get_product_count(&env)
    }

    pub fn warranty_count(env: Env) -> u32 {
        get_warranty_count(&env)
    }

    pub fn claim_count(env: Env) -> u32 {
        get_claim_count(&env)
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admin = get_admin(env)?;
        if *caller != admin {
            return Err(Error::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn assert_admin_or_manufacturer(
        env: &Env,
        caller: &Address,
        manufacturer: &Address,
    ) -> Result<(), Error> {
        let admin = get_admin(env)?;
        if *caller != admin && *caller != *manufacturer {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }
}
