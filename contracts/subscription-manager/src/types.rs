use soroban_sdk::{contracterror, contracttype, Address, String};

/// All errors the contract can return
#[contracterror]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Error {
    // Initialisation
    AlreadyInitialized = 1,
    NotInitialized = 2,

    // Auth
    Unauthorized = 3,

    // Plans
    PlanNotFound = 4,
    PlanAlreadyExists = 5,
    PlanInactive = 6,

    // Subscriptions
    SubscriptionNotFound = 7,
    AlreadySubscribed = 8,
    SubscriptionCancelled = 9,
    SubscriptionNotDue = 10,

    // Amounts / arithmetic
    InvalidAmount = 11,
    InvalidInterval = 12,
    InsufficientBalance = 13,
    Overflow = 14,
}

/// A billing plan defined by the contract admin
#[derive(Clone)]
#[contracttype]
pub struct Plan {
    /// Unique identifier (sequential u64)
    pub plan_id: u64,
    /// Human-readable name stored on-chain
    pub name: String,
    /// Price per billing cycle in the smallest token unit (e.g. stroops)
    pub price: i128,
    /// Billing interval in seconds (e.g. 2592000 = 30 days)
    pub interval: u64,
    /// Token contract address used for payment
    pub token: Address,
    /// Whether new subscriptions may be created against this plan
    pub active: bool,
}

/// Status of a subscriber's subscription
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum SubStatus {
    Active = 1,
    Cancelled = 2,
}

/// A subscription held by a subscriber
#[derive(Clone)]
#[contracttype]
pub struct Subscription {
    pub subscription_id: u64,
    pub plan_id: u64,
    pub subscriber: Address,
    /// Ledger timestamp of when the subscription was first created
    pub created_at: u64,
    /// Ledger timestamp when the next payment becomes due
    pub next_payment_due: u64,
    /// Total number of successful billing cycles
    pub cycles_paid: u64,
    pub status: SubStatus,
}

/// Instance-level storage keys (single-value config)
#[contracttype]
pub enum InstanceKey {
    Admin,
    Initialized,
    PlanCounter,
    SubCounter,
}

/// Persistent storage keys keyed by identifier
#[contracttype]
pub enum DataKey {
    Plan(u64),
    Subscription(u64),
    /// Index: subscriber address → their subscription id (one active sub per plan per user)
    SubscriberPlan(Address, u64),
}
