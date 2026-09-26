use soroban_sdk::{contract, Address, String};

pub type PlanId = u32;
pub type SubscriptionId = u32;

#[derive(Clone)]
#[contract]
pub struct Plan {
    pub id: PlanId,
    pub name: String,
    pub price: i128,
    pub billing_cycle_days: u32,
    pub grace_period_days: u32,
}

#[derive(Clone, PartialEq)]
#[contract]
pub enum SubscriptionStatus {
    Active = 0,
    Paused = 1,
    Cancelled = 2,
}

#[derive(Clone)]
#[contract]
pub struct Subscription {
    pub id: SubscriptionId,
    pub subscriber: Address,
    pub plan_id: PlanId,
    pub status: SubscriptionStatus,
    pub started_at: u64,
    pub last_renewal: u64,
    pub next_renewal: u64,
    pub grace_period_until: u64,
}

#[derive(Clone, Copy, PartialEq)]
#[repr(u32)]
pub enum DataKey {
    Plan = 1,
    Subscription = 2,
    SubscriptionCount = 3,
    Admin = 4,
    Initialized = 5,
}

#[derive(Clone, Copy, PartialEq)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    NotInitialized = 2,
    AlreadyInitialized = 3,
    InvalidPrice = 4,
    InvalidPlan = 5,
    PlanNotFound = 6,
    SubscriptionNotFound = 7,
    SubscriptionInactive = 8,
    GracePeriodExpired = 9,
}
