// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Supply Chain Tracking Contract
//!
//! Tracks products from registration through delivery with:
//! - Provenance verification via metadata hashes
//! - Checkpoint-based traceability (location + handler at each step)
//! - Quality assurance reports by authorised inspectors
//! - Recall mechanism for compromised products
//! - Emergency pause / unpause (admin only)
//! - Event emissions for all critical state changes

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, String};

use crate::storage::{
    get_admin, get_checkpoint, get_checkpoint_count, get_product, get_product_count,
    get_quality_report, is_handler, is_initialized, is_inspector, is_paused, set_admin,
    set_checkpoint, set_checkpoint_count, set_handler, set_inspector, set_paused, set_product,
    set_product_count, set_quality_report,
};
use crate::types::{Checkpoint, Error, Product, ProductStatus, QualityReport, QualityResult};

// ── Event topic symbols ───────────────────────────────────────────────────────

const EVT_INIT: soroban_sdk::Symbol = symbol_short!("init");
const EVT_PAUSE: soroban_sdk::Symbol = symbol_short!("pause");
const EVT_UNPAUSE: soroban_sdk::Symbol = symbol_short!("unpause");
const EVT_REG: soroban_sdk::Symbol = symbol_short!("reg");
const EVT_CHKPT: soroban_sdk::Symbol = symbol_short!("chkpt");
const EVT_STATUS: soroban_sdk::Symbol = symbol_short!("status");
const EVT_QA: soroban_sdk::Symbol = symbol_short!("qa");
const EVT_RECALL: soroban_sdk::Symbol = symbol_short!("recall");

#[contract]
pub struct SupplyChain;

#[contractimpl]
impl SupplyChain {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        env.events().publish((EVT_INIT,), admin);
        Ok(())
    }

    // ── Emergency pause ───────────────────────────────────────────────────────

    /// Pause all state-mutating operations. Admin only.
    pub fn pause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        set_paused(&env, true);
        env.events().publish((EVT_PAUSE,), caller);
        Ok(())
    }

    /// Resume normal operations. Admin only.
    pub fn unpause(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        set_paused(&env, false);
        env.events().publish((EVT_UNPAUSE,), caller);
        Ok(())
    }

    /// Returns true when the contract is paused.
    pub fn paused(env: Env) -> bool {
        is_paused(&env)
    }

    // ── Role management ───────────────────────────────────────────────────────

    pub fn add_inspector(env: Env, caller: Address, inspector: Address) -> Result<(), Error> {
        caller.require_auth();
        let admin = get_admin(&env)?;
        if caller != admin {
            return Err(Error::Unauthorized);
        }
        set_inspector(&env, &inspector, true);
        Ok(())
    }

    pub fn remove_inspector(env: Env, caller: Address, inspector: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        set_inspector(&env, &inspector, false);
        Ok(())
    }

    pub fn add_handler(env: Env, caller: Address, handler: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        set_handler(&env, &handler, true);
        Ok(())
    }

    pub fn remove_handler(env: Env, caller: Address, handler: Address) -> Result<(), Error> {
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        set_handler(&env, &handler, false);
        Ok(())
    }

    // ── Product registration ──────────────────────────────────────────────────

    /// Register a new product. Returns the new product ID.
    ///
    /// Emits: `("reg", product_id)`
    pub fn register_product(
        env: Env,
        owner: Address,
        name: String,
        metadata_hash: u64,
    ) -> Result<u32, Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        owner.require_auth();
        if name.is_empty() {
            return Err(Error::EmptyName);
        }
        let id = get_product_count(&env) + 1;
        let now = env.ledger().timestamp();
        let product = Product {
            id,
            owner: owner.clone(),
            name,
            metadata_hash,
            status: ProductStatus::Registered,
            created_at: now,
            updated_at: now,
        };
        set_product(&env, &product);
        set_product_count(&env, id);
        env.events().publish((EVT_REG,), (id, owner));
        Ok(id)
    }

    // ── Checkpoint / traceability ─────────────────────────────────────────────

    /// Record a supply chain checkpoint (location + handler).
    ///
    /// Emits: `("chkpt", product_id, checkpoint_index)`
    pub fn add_checkpoint(
        env: Env,
        handler: Address,
        product_id: u32,
        location_hash: u64,
        notes_hash: u64,
    ) -> Result<u32, Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        handler.require_auth();
        if !is_handler(&env, &handler) {
            return Err(Error::NotHandler);
        }
        let mut product = get_product(&env, product_id)?;
        if product.status == ProductStatus::Recalled {
            return Err(Error::AlreadyRecalled);
        }

        let index = get_checkpoint_count(&env, product_id) + 1;
        let now = env.ledger().timestamp();
        let checkpoint = Checkpoint {
            product_id,
            index,
            handler: handler.clone(),
            location_hash,
            notes_hash,
            timestamp: now,
        };
        set_checkpoint(&env, &checkpoint);
        set_checkpoint_count(&env, product_id, index);

        product.status = ProductStatus::InTransit;
        product.updated_at = now;
        set_product(&env, &product);
        env.events().publish((EVT_CHKPT,), (product_id, index, handler));
        Ok(index)
    }

    /// Update product status (e.g. AtWarehouse, QualityCheck, Delivered).
    ///
    /// Emits: `("status", product_id, new_status_u32)`
    pub fn update_status(
        env: Env,
        caller: Address,
        product_id: u32,
        new_status: ProductStatus,
    ) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        caller.require_auth();
        let admin = get_admin(&env)?;
        let is_auth = caller == admin || is_handler(&env, &caller);
        if !is_auth {
            return Err(Error::Unauthorized);
        }
        let mut product = get_product(&env, product_id)?;
        if product.status == ProductStatus::Recalled {
            return Err(Error::AlreadyRecalled);
        }
        product.status = new_status;
        product.updated_at = env.ledger().timestamp();
        set_product(&env, &product);
        env.events().publish((EVT_STATUS,), (product_id, new_status as u32));
        Ok(())
    }

    // ── Quality assurance ─────────────────────────────────────────────────────

    /// Submit a quality inspection report.
    ///
    /// Emits: `("qa", product_id, result_u32)`
    pub fn submit_quality_report(
        env: Env,
        inspector: Address,
        product_id: u32,
        result: QualityResult,
        report_hash: u64,
    ) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        inspector.require_auth();
        if !is_inspector(&env, &inspector) {
            return Err(Error::NotInspector);
        }
        let mut product = get_product(&env, product_id)?;
        if product.status == ProductStatus::Recalled {
            return Err(Error::AlreadyRecalled);
        }
        let now = env.ledger().timestamp();
        let report = QualityReport {
            product_id,
            inspector: inspector.clone(),
            result,
            report_hash,
            timestamp: now,
        };
        set_quality_report(&env, &report);

        product.status = match result {
            QualityResult::Pass => ProductStatus::Approved,
            QualityResult::Fail => ProductStatus::Rejected,
            QualityResult::Pending => ProductStatus::QualityCheck,
        };
        product.updated_at = now;
        set_product(&env, &product);
        env.events().publish((EVT_QA,), (product_id, result as u32, inspector));
        Ok(())
    }

    // ── Recall ────────────────────────────────────────────────────────────────

    /// Recall a product. Admin only.
    ///
    /// Emits: `("recall", product_id)`
    pub fn recall_product(env: Env, caller: Address, product_id: u32) -> Result<(), Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        caller.require_auth();
        if caller != get_admin(&env)? {
            return Err(Error::Unauthorized);
        }
        let mut product = get_product(&env, product_id)?;
        if product.status == ProductStatus::Recalled {
            return Err(Error::AlreadyRecalled);
        }
        product.status = ProductStatus::Recalled;
        product.updated_at = env.ledger().timestamp();
        set_product(&env, &product);
        env.events().publish((EVT_RECALL,), product_id);
        Ok(())
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_product(env: Env, product_id: u32) -> Result<Product, Error> {
        get_product(&env, product_id)
    }

    pub fn get_checkpoint(env: Env, product_id: u32, index: u32) -> Result<Checkpoint, Error> {
        get_checkpoint(&env, product_id, index).ok_or(Error::ProductNotFound)
    }

    pub fn get_checkpoint_count(env: Env, product_id: u32) -> u32 {
        get_checkpoint_count(&env, product_id)
    }

    pub fn get_quality_report(env: Env, product_id: u32) -> Result<QualityReport, Error> {
        get_quality_report(&env, product_id)
    }

    pub fn product_count(env: Env) -> u32 {
        get_product_count(&env)
    }
}
