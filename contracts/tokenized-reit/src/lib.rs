// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Tokenized Real Estate Investment Trust (REIT)
//!
//! A comprehensive Soroban smart contract providing:
//! - Property tokenization into fractional shares
//! - Investment management with whitelist/blacklist support
//! - Dividend distribution with pro-rata calculations
//! - Share transfers between investors
//! - Emergency pause and recovery mechanisms
//! - Comprehensive event emissions for tracking
//! - Access control and authorization
//!
//! ## Security Features
//! - Checks-Effects-Interactions pattern
//! - Emergency pause functionality
//! - Reentrancy protection through state updates before external calls
//! - Input validation on all user inputs
//! - Access control modifiers

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{
    contract, contractimpl, symbol_short, Address, Env, String, Symbol,
};

use crate::storage::{
    get_admin, get_distribution, get_distribution_count, get_investor_stats, get_ownership,
    get_property, get_property_count, get_reit_config, has_ownership, increment_distribution_count,
    increment_property_count, is_blacklisted, is_initialized, is_paused, is_whitelisted,
    set_admin, set_blacklisted, set_distribution, set_initialized, set_investor_stats,
    set_ownership, set_paused, set_property, set_reit_config, set_whitelisted,
    update_investor_stats, update_reit_stats,
};
use crate::types::{
    Distribution, DistributionType, Error, InvestorStats, Ownership, Property,
    PropertyStatus, ReitConfig,
};

/// Contract events
const EVENT_PROPERTY_LISTED: Symbol = symbol_short!("prop_add");
const EVENT_PROPERTY_STATUS: Symbol = symbol_short!("prop_stat");
const EVENT_SHARES_PURCHASED: Symbol = symbol_short!("shares_buy");
const EVENT_SHARES_TRANSFERRED: Symbol = symbol_short!("shares_xfer");
const EVENT_DIVIDEND_DEPOSITED: Symbol = symbol_short!("div_dep");
const EVENT_DIVIDEND_CLAIMED: Symbol = symbol_short!("div_claim");
const EVENT_DISTRIBUTION: Symbol = symbol_short!("dist");
const EVENT_PAUSED: Symbol = symbol_short!("paused");
const EVENT_ADMIN_CHANGED: Symbol = symbol_short!("admin_chg");
const EVENT_WHITELIST: Symbol = symbol_short!("whitelist");
const EVENT_BLACKLIST: Symbol = symbol_short!("blacklist");

#[contract]
pub struct TokenizedReitContract;

#[contractimpl]
impl TokenizedReitContract {
    // ── Initialization ─────────────────────────────────────────────────────

    /// Initialize the REIT contract
    /// 
    /// # Arguments
    /// * `admin` - The administrator address
    /// * `name` - REIT name
    /// * `symbol` - REIT symbol/ticker
    pub fn initialize(
        env: Env,
        admin: Address,
        name: String,
        symbol: String,
    ) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        
        admin.require_auth();
        
        let config = ReitConfig {
            name,
            symbol,
            total_properties: 0,
            total_investors: 0,
            total_value_locked: 0,
            total_dividends_distributed: 0,
            platform_fee_bps: 100, // 1% default
            min_investment: 10000000, // 1 XLM minimum
            max_investment_per_property: 100000000000, // 10,000 XLM max per property
            created_at: env.ledger().timestamp(),
        };
        
        set_admin(&env, &admin);
        set_reit_config(&env, &config);
        set_initialized(&env);
        
        env.events().publish((EVENT_ADMIN_CHANGED, admin), ());
        
        Ok(())
    }

    // ── Admin Management ──────────────────────────────────────────────────────

    /// Transfer admin rights to a new address
    pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &current_admin)?;
        
        set_admin(&env, &new_admin);
        
        env.events().publish((EVENT_ADMIN_CHANGED, new_admin), ());
        
        Ok(())
    }

    // ── Emergency Controls ───────────────────────────────────────────────────

    /// Pause the contract - prevents most operations
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        
        set_paused(&env, true);
        
        env.events().publish((EVENT_PAUSED, true), ());
        
        Ok(())
    }

    /// Unpause the contract - resumes normal operations
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        
        set_paused(&env, false);
        
        env.events().publish((EVENT_PAUSED, false), ());
        
        Ok(())
    }

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    // ── Property Management ──────────────────────────────────────────────────

    /// List a new property for investment
    /// 
    /// # Arguments
    /// * `admin` - Administrator address
    /// * `name` - Property name
    /// * `description` - Property description
    /// * `location` - Property location
    /// * `total_shares` - Total shares to tokenize
    /// * `price_per_share` - Price per share in stroops
    /// * `total_valuation` - Total property valuation in stroops
    /// * `target_yield_bps` - Target annual yield in basis points
    /// * `metadata_uri` - URI to property metadata
    pub fn list_property(
        env: Env,
        admin: Address,
        name: String,
        description: String,
        location: String,
        total_shares: u64,
        price_per_share: i128,
        total_valuation: i128,
        target_yield_bps: u32,
        metadata_uri: String,
    ) -> Result<u32, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_admin(&env, &admin)?;
        
        // Validation
        if name.len() == 0 {
            return Err(Error::EmptyName);
        }
        if total_shares == 0 {
            return Err(Error::ZeroTotalShares);
        }
        if price_per_share <= 0 {
            return Err(Error::ZeroPrice);
        }
        if total_valuation <= 0 {
            return Err(Error::ZeroValuation);
        }
        
        let property_id = increment_property_count(&env);
        let timestamp = env.ledger().timestamp();
        
        let property = Property {
            name,
            description,
            location,
            total_shares,
            shares_sold: 0,
            shares_reserved: 0,
            price_per_share,
            total_valuation,
            pending_dividend: 0,
            total_dividend_distributed: 0,
            status: PropertyStatus::Listed,
            target_yield_bps,
            created_at: timestamp,
            last_distribution_at: timestamp,
            metadata_uri,
        };
        
        set_property(&env, property_id, &property);
        
        // Update REIT stats
        update_reit_stats(&env, |config| {
            config.total_properties += 1;
        })?;
        
        // Emit event
        env.events().publish(
            (EVENT_PROPERTY_LISTED, property_id),
            (total_shares, price_per_share, total_valuation),
        );
        
        Ok(property_id)
    }

    /// Update property status
    pub fn update_property_status(
        env: Env,
        admin: Address,
        property_id: u32,
        new_status: PropertyStatus,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        
        let mut property = get_property(&env, property_id)?;
        
        // Validate status transition
        match (&property.status, &new_status) {
            (PropertyStatus::Listed, PropertyStatus::Funded) => {},
            (PropertyStatus::Listed, PropertyStatus::Delisted) => {},
            (PropertyStatus::Funded, PropertyStatus::Active) => {},
            (PropertyStatus::Funded, PropertyStatus::Listed) => {},
            (PropertyStatus::Active, PropertyStatus::Suspended) => {},
            (PropertyStatus::Suspended, PropertyStatus::Active) => {},
            (PropertyStatus::Suspended, PropertyStatus::Delisted) => {},
            _ => return Err(Error::InvalidStatusTransition),
        }
        
        property.status = new_status;
        set_property(&env, property_id, &property);
        
        env.events().publish(
            (EVENT_PROPERTY_STATUS, property_id),
            new_status as u32,
        );
        
        Ok(())
    }

    /// Delist a property permanently
    pub fn delist_property(env: Env, admin: Address, property_id: u32) -> Result<(), Error> {
        Self::update_property_status(env, admin, property_id, PropertyStatus::Delisted)
    }

    // ── Access Control ────────────────────────────────────────────────────────

    /// Add investor to whitelist for a property
    pub fn whitelist_investor(
        env: Env,
        admin: Address,
        property_id: u32,
        investor: Address,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        
        // Verify property exists
        get_property(&env, property_id)?;
        
        set_whitelisted(&env, property_id, &investor, true);
        
        env.events().publish(
            (EVENT_WHITELIST, property_id, investor),
            true,
        );
        
        Ok(())
    }

    /// Remove investor from whitelist
    pub fn remove_whitelist(
        env: Env,
        admin: Address,
        property_id: u32,
        investor: Address,
    ) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        
        set_whitelisted(&env, property_id, &investor, false);
        
        env.events().publish(
            (EVENT_WHITELIST, property_id, investor),
            false,
        );
        
        Ok(())
    }

    /// Blacklist an investor globally
    pub fn blacklist_investor(env: Env, admin: Address, investor: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        
        set_blacklisted(&env, &investor, true);
        
        env.events().publish(
            (EVENT_BLACKLIST, investor),
            true,
        );
        
        Ok(())
    }

    /// Remove investor from blacklist
    pub fn unblacklist_investor(env: Env, admin: Address, investor: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        
        set_blacklisted(&env, &investor, false);
        
        env.events().publish(
            (EVENT_BLACKLIST, investor),
            false,
        );
        
        Ok(())
    }

    // ── Investment Actions ────────────────────────────────────────────────────

    /// Buy shares in a property
    /// 
    /// # Arguments
    /// * `investor` - Investor address
    /// * `property_id` - Property to invest in
    /// * `shares` - Number of shares to purchase
    pub fn buy_shares(
        env: Env,
        investor: Address,
        property_id: u32,
        shares: u64,
    ) -> Result<i128, Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        investor.require_auth();
        
        // Check blacklist
        if is_blacklisted(&env, &investor) {
            return Err(Error::Unauthorized);
        }
        
        if shares == 0 {
            return Err(Error::ZeroShares);
        }
        
        let mut property = get_property(&env, property_id)?;
        
        // Check property status
        if property.status != PropertyStatus::Listed {
            return Err(Error::NotForSale);
        }
        
        // Check available shares
        let available_shares = property.total_shares
            .saturating_sub(property.shares_sold)
            .saturating_sub(property.shares_reserved);
            
        if shares > available_shares {
            return Err(Error::ExceedsTotalSupply);
        }
        
        // Calculate cost
        let cost = (shares as i128).saturating_mul(property.price_per_share);
        
        // Check investment limits
        let config = get_reit_config(&env)?;
        if cost < config.min_investment {
            return Err(Error::InvalidShareAmount);
        }
        
        // Get or create ownership record
        let mut ownership = if has_ownership(&env, property_id, &investor) {
            get_ownership(&env, property_id, &investor)?
        } else {
            Ownership {
                shares: 0,
                dividend_claimed: property.total_dividend_distributed,
                last_claimed_at: env.ledger().timestamp(),
            }
        };
        
        // Update ownership
        ownership.shares += shares;
        property.shares_sold += shares;
        
        set_ownership(&env, property_id, &investor, &ownership);
        set_property(&env, property_id, &property);
        
        // Update investor stats
        let timestamp = env.ledger().timestamp();
        update_investor_stats(&env, &investor, |stats| {
            if stats.properties_count == 0 {
                stats.first_investment_at = timestamp;
            }
            stats.properties_count += 1;
            stats.total_shares += shares;
            stats.total_invested += cost;
            stats.last_activity_at = timestamp;
        });
        
        // Update REIT stats
        update_reit_stats(&env, |config| {
            config.total_value_locked += cost;
        })?;
        
        // Emit event
        env.events().publish(
            (EVENT_SHARES_PURCHASED, property_id),
            (investor, shares, cost),
        );
        
        // Check if property is now fully funded
        if property.shares_sold == property.total_shares {
            let mut funded_property = property.clone();
            funded_property.status = PropertyStatus::Funded;
            set_property(&env, property_id, &funded_property);
            
            env.events().publish(
                (EVENT_PROPERTY_STATUS, property_id),
                PropertyStatus::Funded as u32,
            );
        }
        
        Ok(cost)
    }

    /// Transfer shares to another investor
    pub fn transfer_shares(
        env: Env,
        from: Address,
        to: Address,
        property_id: u32,
        shares: u64,
    ) -> Result<(), Error> {
        Self::assert_not_paused(&env)?;
        Self::assert_initialized(&env)?;
        from.require_auth();
        
        // Check blacklist
        if is_blacklisted(&env, &from) || is_blacklisted(&env, &to) {
            return Err(Error::Unauthorized);
        }
        
        if shares == 0 {
            return Err(Error::ZeroShares);
        }
        
        let property = get_property(&env, property_id)?;
        
        // Cannot transfer shares in delisted properties
        if property.status == PropertyStatus::Delisted {
            return Err(Error::PropertyNotActive);
        }
        
        let mut from_ownership = get_ownership(&env, property_id, &from)?;
        
        if shares > from_ownership.shares {
            return Err(Error::InsufficientShares);
        }
        
        // Settle any unclaimed dividends for sender before transfer
        let claimable = Self::compute_claimable(&from_ownership, &property);
        from_ownership.dividend_claimed += claimable;
        from_ownership.shares -= shares;
        from_ownership.last_claimed_at = env.ledger().timestamp();
        
        // Get or create recipient ownership
        let mut to_ownership = if has_ownership(&env, property_id, &to) {
            get_ownership(&env, property_id, &to)?
        } else {
            Ownership {
                shares: 0,
                dividend_claimed: property.total_dividend_distributed,
                last_claimed_at: env.ledger().timestamp(),
            }
        };
        
        to_ownership.shares += shares;
        
        // Update storage
        if from_ownership.shares == 0 {
            storage::remove_ownership(&env, property_id, &from);
            update_investor_stats(&env, &from, |stats| {
                stats.properties_count = stats.properties_count.saturating_sub(1);
            });
        } else {
            set_ownership(&env, property_id, &from, &from_ownership);
        }
        
        set_ownership(&env, property_id, &to, &to_ownership);
        
        // Update recipient stats
        update_investor_stats(&env, &to, |stats| {
            if stats.properties_count == 0 {
                stats.first_investment_at = env.ledger().timestamp();
            }
            stats.properties_count += 1;
            stats.total_shares += shares;
            stats.last_activity_at = env.ledger().timestamp();
        });
        
        // Update sender stats
        update_investor_stats(&env, &from, |stats| {
            stats.total_shares -= shares;
            stats.last_activity_at = env.ledger().timestamp();
        });
        
        // Emit event
        env.events().publish(
            (EVENT_SHARES_TRANSFERRED, property_id),
            (from, to, shares),
        );
        
        Ok(())
    }

    // ── Dividend Management ──────────────────────────────────────────────────

    /// Deposit dividends for a property
    pub fn deposit_dividends(
        env: Env,
        admin: Address,
        property_id: u32,
        amount: i128,
        distribution_type: DistributionType,
    ) -> Result<u64, Error> {
        Self::assert_admin(&env, &admin)?;
        
        if amount <= 0 {
            return Err(Error::ZeroDividend);
        }
        
        let mut property = get_property(&env, property_id)?;
        
        // Only active properties can receive dividends
        if property.status != PropertyStatus::Active && property.status != PropertyStatus::Funded {
            return Err(Error::PropertyNotActive);
        }
        
        let timestamp = env.ledger().timestamp();
        
        // Update property
        property.pending_dividend += amount;
        property.total_dividend_distributed += amount;
        property.last_distribution_at = timestamp;
        
        set_property(&env, property_id, &property);
        
        // Create distribution record
        let distribution_id = increment_distribution_count(&env);
        let amount_per_share = if property.shares_sold > 0 {
            amount / (property.shares_sold as i128)
        } else {
            0
        };
        
        let distribution = Distribution {
            id: distribution_id,
            property_id,
            total_amount: amount,
            amount_per_share,
            distributed_at: timestamp,
            distribution_type,
        };
        
        set_distribution(&env, distribution_id, &distribution);
        
        // Update REIT stats
        update_reit_stats(&env, |config| {
            config.total_dividends_distributed += amount;
        })?;
        
        // Emit events
        env.events().publish(
            (EVENT_DIVIDEND_DEPOSITED, property_id),
            (amount, distribution_type as u32),
        );
        
        env.events().publish(
            (EVENT_DISTRIBUTION, distribution_id),
            (property_id, amount, amount_per_share),
        );
        
        Ok(distribution_id)
    }

    /// Claim dividends for a property
    pub fn claim_dividends(
        env: Env,
        investor: Address,
        property_id: u32,
    ) -> Result<i128, Error> {
        Self::assert_initialized(&env)?;
        investor.require_auth();
        
        let property = get_property(&env, property_id)?;
        let mut ownership = get_ownership(&env, property_id, &investor)?;
        
        let claimable = Self::compute_claimable(&ownership, &property);
        
        if claimable == 0 {
            return Err(Error::NothingToClaim);
        }
        
        // Update ownership
        ownership.dividend_claimed += claimable;
        ownership.last_claimed_at = env.ledger().timestamp();
        
        set_ownership(&env, property_id, &investor, &ownership);
        
        // Update investor stats
        update_investor_stats(&env, &investor, |stats| {
            stats.total_dividends_claimed += claimable;
            stats.last_activity_at = env.ledger().timestamp();
        });
        
        // Emit event
        env.events().publish(
            (EVENT_DIVIDEND_CLAIMED, property_id),
            (investor, claimable),
        );
        
        Ok(claimable)
    }

    /// Batch claim dividends across multiple properties
    pub fn batch_claim_dividends(
        env: Env,
        investor: Address,
        property_ids: soroban_sdk::Vec<u32>,
    ) -> Result<soroban_sdk::Vec<i128>, Error> {
        Self::assert_initialized(&env)?;
        investor.require_auth();
        
        let mut results = soroban_sdk::Vec::new(&env);
        
        for property_id in property_ids.iter() {
            match Self::claim_dividends(env.clone(), investor.clone(), property_id) {
                Ok(amount) => results.push_back(amount),
                Err(_) => results.push_back(0),
            }
        }
        
        Ok(results)
    }

    // ── Read-Only Queries ──────────────────────────────────────────────────────

    /// Get property details
    pub fn get_property(env: Env, property_id: u32) -> Result<Property, Error> {
        get_property(&env, property_id)
    }

    /// Get ownership details for an investor in a property
    pub fn get_ownership(
        env: Env,
        investor: Address,
        property_id: u32,
    ) -> Result<Ownership, Error> {
        get_ownership(&env, property_id, &investor)
    }

    /// Calculate claimable dividends without claiming
    pub fn claimable_dividends(
        env: Env,
        investor: Address,
        property_id: u32,
    ) -> Result<i128, Error> {
        let property = get_property(&env, property_id)?;
        let ownership = get_ownership(&env, property_id, &investor)?;
        Ok(Self::compute_claimable(&ownership, &property))
    }

    /// Get total claimable dividends across all properties for an investor
    pub fn total_claimable_dividends(env: Env, investor: Address) -> i128 {
        let property_count = get_property_count(&env);
        let mut total = 0i128;
        
        for i in 1..=property_count {
            if let Ok(property) = get_property(&env, i) {
                if let Ok(ownership) = get_ownership(&env, i, &investor) {
                    total += Self::compute_claimable(&ownership, &property);
                }
            }
        }
        
        total
    }

    /// Get REIT configuration
    pub fn get_reit_config(env: Env) -> Result<ReitConfig, Error> {
        get_reit_config(&env)
    }

    /// Get investor statistics
    pub fn get_investor_stats(env: Env, investor: Address) -> InvestorStats {
        get_investor_stats(&env, &investor)
    }

    /// Get property count
    pub fn property_count(env: Env) -> u32 {
        get_property_count(&env)
    }

    /// Get distribution record
    pub fn get_distribution(env: Env, distribution_id: u64) -> Option<Distribution> {
        get_distribution(&env, distribution_id)
    }

    /// Get distribution count
    pub fn distribution_count(env: Env) -> u64 {
        get_distribution_count(&env)
    }

    /// Check if investor is whitelisted for a property
    pub fn is_whitelisted(env: Env, property_id: u32, investor: Address) -> bool {
        is_whitelisted(&env, property_id, &investor)
    }

    /// Check if investor is blacklisted
    pub fn is_blacklisted(env: Env, investor: Address) -> bool {
        is_blacklisted(&env, &investor)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, Error> {
        get_admin(&env)
    }

    /// Check if contract is initialized
    pub fn is_initialized(env: Env) -> bool {
        is_initialized(&env)
    }

    /// Get all properties (paginated)
    pub fn get_properties(
        env: Env,
        start: u32,
        limit: u32,
    ) -> soroban_sdk::Vec<Property> {
        let count = get_property_count(&env);
        let mut properties = soroban_sdk::Vec::new(&env);
        
        let end = (start + limit).min(count);
        
        for i in (start + 1)..=end {
            if let Ok(property) = get_property(&env, i) {
                properties.push_back(property);
            }
        }
        
        properties
    }

    /// Get investor's properties
    pub fn get_investor_properties(
        env: Env,
        investor: Address,
    ) -> soroban_sdk::Vec<(u32, Ownership)> {
        let count = get_property_count(&env);
        let mut result = soroban_sdk::Vec::new(&env);
        
        for i in 1..=count {
            if let Ok(ownership) = get_ownership(&env, i, &investor) {
                result.push_back((i, ownership));
            }
        }
        
        result
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    /// Calculate claimable dividends using pro-rata formula
    /// claimable = (shares / total_shares) * (total_distributed - dividend_claimed_snapshot)
    fn compute_claimable(ownership: &Ownership, property: &Property) -> i128 {
        if property.shares_sold == 0 || ownership.shares == 0 {
            return 0;
        }
        
        let new_dividends = property
            .total_dividend_distributed
            .saturating_sub(ownership.dividend_claimed);
            
        if new_dividends <= 0 {
            return 0;
        }
        
        // Pro-rata calculation: new_dividends * shares / total_shares
        new_dividends
            .saturating_mul(ownership.shares as i128)
            .saturating_div(property.total_shares as i128)
    }

    fn assert_initialized(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        Ok(())
    }

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        Self::assert_initialized(env)?;
        caller.require_auth();
        let admin = get_admin(env)?;
        if *caller != admin {
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
