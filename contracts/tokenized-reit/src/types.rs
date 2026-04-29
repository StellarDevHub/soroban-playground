// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address, String, Symbol};

/// Custom errors for the REIT contract
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Contract already initialized
    AlreadyInitialized = 1,
    /// Contract not yet initialized
    NotInitialized = 2,
    /// Caller is not the admin
    Unauthorized = 3,
    /// Property does not exist
    PropertyNotFound = 4,
    /// Investor has no shares in this property
    NoShares = 5,
    /// Share amount must be greater than zero
    ZeroShares = 6,
    /// Transfer amount exceeds owned shares
    InsufficientShares = 7,
    /// Total shares would exceed the property's total supply
    ExceedsTotalSupply = 8,
    /// Property name must not be empty
    EmptyName = 9,
    /// Total shares must be greater than zero
    ZeroTotalShares = 10,
    /// Price per share must be greater than zero
    ZeroPrice = 11,
    /// Dividend amount must be greater than zero
    ZeroDividend = 12,
    /// No dividend available to claim
    NothingToClaim = 13,
    /// Property is not listed for investment
    NotForSale = 14,
    /// Contract is paused
    ContractPaused = 15,
    /// Invalid property status transition
    InvalidStatusTransition = 16,
    /// Property is not active
    PropertyNotActive = 17,
    /// Dividend distribution period not ended
    DistributionPeriodActive = 18,
    /// Invalid dividend rate
    InvalidDividendRate = 19,
    /// Property valuation must be greater than zero
    ZeroValuation = 20,
    /// Invalid share amount for operation
    InvalidShareAmount = 21,
    /// Property is fully funded
    PropertyFullyFunded = 22,
}

/// Property investment status
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum PropertyStatus {
    /// Property is listed and accepting investments
    Listed,
    /// Property funding goal reached, awaiting activation
    Funded,
    /// Property is active and generating returns
    Active,
    /// Property is temporarily suspended
    Suspended,
    /// Property has been delisted
    Delisted,
}

/// A tokenized real estate property in the REIT
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Property {
    /// Human-readable name / address
    pub name: String,
    /// Detailed description of the property
    pub description: String,
    /// Property location
    pub location: String,
    /// Total fractional shares representing 100% ownership
    pub total_shares: u64,
    /// Shares already sold to investors
    pub shares_sold: u64,
    /// Shares reserved for specific purposes
    pub shares_reserved: u64,
    /// Price per share in stroops
    pub price_per_share: i128,
    /// Total valuation of the property in stroops
    pub total_valuation: i128,
    /// Accumulated dividends not yet distributed (in stroops)
    pub pending_dividend: i128,
    /// Total dividends ever deposited (used for pro-rata calculation)
    pub total_dividend_distributed: i128,
    /// Current property status
    pub status: PropertyStatus,
    /// Annual dividend yield percentage (basis points, 1% = 100)
    pub target_yield_bps: u32,
    /// Property creation timestamp
    pub created_at: u64,
    /// Last dividend distribution timestamp
    pub last_distribution_at: u64,
    /// Property metadata URI (e.g., IPFS link)
    pub metadata_uri: String,
}

/// Tracks an investor's fractional ownership in a property
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Ownership {
    /// Number of shares held
    pub shares: u64,
    /// Dividends already claimed by this investor (snapshot for pro-rata)
    pub dividend_claimed: i128,
    /// Last claim timestamp
    pub last_claimed_at: u64,
}

/// REIT-level configuration and statistics
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ReitConfig {
    /// REIT name
    pub name: String,
    /// REIT symbol/ticker
    pub symbol: String,
    /// Total properties in the REIT
    pub total_properties: u32,
    /// Total investors
    pub total_investors: u32,
    /// Total value under management (in stroops)
    pub total_value_locked: i128,
    /// Total dividends distributed (in stroops)
    pub total_dividends_distributed: i128,
    /// Platform fee percentage (basis points)
    pub platform_fee_bps: u32,
    /// Minimum investment amount (in stroops)
    pub min_investment: i128,
    /// Maximum investment amount per property (in stroops)
    pub max_investment_per_property: i128,
    /// Creation timestamp
    pub created_at: u64,
}

/// Investor statistics across all properties
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct InvestorStats {
    /// Total properties invested in
    pub properties_count: u32,
    /// Total shares owned across all properties
    pub total_shares: u64,
    /// Total value invested (in stroops)
    pub total_invested: i128,
    /// Total dividends claimed (in stroops)
    pub total_dividends_claimed: i128,
    /// First investment timestamp
    pub first_investment_at: u64,
    /// Last activity timestamp
    pub last_activity_at: u64,
}

/// Dividend distribution record
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Distribution {
    /// Distribution ID
    pub id: u64,
    /// Property ID
    pub property_id: u32,
    /// Total amount distributed
    pub total_amount: i128,
    /// Amount per share
    pub amount_per_share: i128,
    /// Distribution timestamp
    pub distributed_at: u64,
    /// Distribution type
    pub distribution_type: DistributionType,
}

/// Type of dividend distribution
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum DistributionType {
    /// Regular quarterly distribution
    Quarterly,
    /// Special dividend
    Special,
    /// Property sale proceeds
    SaleProceeds,
    /// Rental income
    RentalIncome,
}

/// Instance-level storage keys
#[contracttype]
pub enum InstanceKey {
    Admin,
    Paused,
    PropertyCount,
    DistributionCount,
    ReitConfig,
}

/// Persistent storage keys
#[contracttype]
pub enum DataKey {
    Property(u32),
    /// Ownership record: (property_id, investor)
    Ownership(u32, Address),
    /// Investor statistics: investor address
    InvestorStats(Address),
    /// Distribution record
    Distribution(u64),
    /// Whitelist status: (property_id, investor)
    Whitelist(u32, Address),
    /// Blacklist status: investor
    Blacklist(Address),
}

/// Events emitted by the contract
pub const EVENT_PROPERTY_LISTED: Symbol = Symbol::new(env(), "prop_listed");
pub const EVENT_PROPERTY_FUNDED: Symbol = Symbol::new(env(), "prop_funded");
pub const EVENT_PROPERTY_ACTIVATED: Symbol = Symbol::new(env(), "prop_active");
pub const EVENT_PROPERTY_SUSPENDED: Symbol = Symbol::new(env(), "prop_susp");
pub const EVENT_PROPERTY_DELISTED: Symbol = Symbol::new(env(), "prop_delist");
pub const EVENT_SHARES_PURCHASED: Symbol = Symbol::new(env(), "shares_buy");
pub const EVENT_SHARES_TRANSFERRED: Symbol = Symbol::new(env(), "shares_xfer");
pub const EVENT_SHARES_SOLD: Symbol = Symbol::new(env(), "shares_sold");
pub const EVENT_DIVIDEND_DEPOSITED: Symbol = Symbol::new(env(), "div_deposit");
pub const EVENT_DIVIDEND_CLAIMED: Symbol = Symbol::new(env(), "div_claim");
pub const EVENT_DISTRIBUTION_CREATED: Symbol = Symbol::new(env(), "dist_create");
pub const EVENT_CONTRACT_PAUSED: Symbol = Symbol::new(env(), "paused");
pub const EVENT_CONTRACT_UNPAUSED: Symbol = Symbol::new(env(), "unpaused");
pub const EVENT_ADMIN_CHANGED: Symbol = Symbol::new(env(), "admin_chg");
pub const EVENT_INVESTOR_WHITELISTED: Symbol = Symbol::new(env(), "whitelist");
pub const EVENT_INVESTOR_BLACKLISTED: Symbol = Symbol::new(env(), "blacklist");

fn env() -> &'static soroban_sdk::Env {
    panic!("This function is only for type definitions")
}
