// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracttype, Address, String, Vec, Uint128};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum SubscriptionStatus {
    Active = 0,
    Cancelled = 1,
    Expired = 2,
}

impl SubscriptionStatus {
    pub fn from_u32(value: u32) -> Self {
        match value {
            0 => SubscriptionStatus::Active,
            1 => SubscriptionStatus::Cancelled,
            2 => SubscriptionStatus::Expired,
            _ => SubscriptionStatus::Expired, // Default fallback
        }
    }
}

#[contracttype]
#[derive(Clone)]
pub struct SubscriptionPlan {
    pub id: String,
    pub name: String,
    pub description: String,
    pub price_per_period: Uint128,
    pub billing_period: u64, // in seconds
    pub features: Vec<String>,
    pub max_subscribers: Option<u32>,
    pub current_subscribers: u32,
    pub is_active: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Subscription {
    pub id: String,
    pub subscriber: Address,
    pub plan_id: String,
    pub payment_method: Address, // Token contract address
    pub status: SubscriptionStatus,
    pub current_period_start: u64,
    pub current_period_end: u64,
    pub auto_renew: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct SubscriptionStats {
    pub total_subscriptions: u32,
    pub active_subscriptions: u32,
    pub cancelled_subscriptions: u32,
    pub total_revenue: Uint128,
}

#[contracttype]
#[derive(Clone)]
pub struct PaymentRecord {
    pub id: String,
    pub subscription_id: String,
    pub amount: Uint128,
    pub timestamp: u64,
    pub payment_method: Address,
    pub transaction_hash: String,
}
