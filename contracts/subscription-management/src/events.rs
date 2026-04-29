// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{Env, String, Address, Uint128};

// Event topics
pub const SYSTEM_TOPIC: &str = "system";
pub const PLAN_TOPIC: &str = "plan";
pub const SUBSCRIPTION_TOPIC: &str = "subscription";
pub const PAYMENT_TOPIC: &str = "payment";

// Event types
pub const INITIALIZED_EVENT: &str = "initialized";
pub const PAUSED_EVENT: &str = "pause_toggled";
pub const FEE_UPDATED_EVENT: &str = "fee_updated";
pub const ADMIN_TRANSFERRED_EVENT: &str = "admin_transferred";

pub const PLAN_CREATED_EVENT: &str = "created";
pub const PLAN_UPDATED_EVENT: &str = "updated";
pub const PLAN_ACTIVATED_EVENT: &str = "activated";
pub const PLAN_DEACTIVATED_EVENT: &str = "deactivated";

pub const SUBSCRIPTION_CREATED_EVENT: &str = "created";
pub const SUBSCRIPTION_CANCELLED_EVENT: &str = "cancelled";
pub const SUBSCRIPTION_RENEWED_EVENT: &str = "renewed";
pub const SUBSCRIPTION_EXPIRED_EVENT: &str = "expired";
pub const SUBSCRIPTION_AUTO_RENEW_TOGGLED_EVENT: &str = "auto_renew_toggled";
pub const SUBSCRIPTION_EMERGENCY_UPDATE_EVENT: &str = "emergency_status_update";

pub const PAYMENT_PROCESSED_EVENT: &str = "processed";
pub const PAYMENT_FAILED_EVENT: &str = "failed";
pub const PAYMENT_REFUNDED_EVENT: &str = "refunded";

// Helper functions for publishing events
pub fn publish_system_event(env: &Env, event_type: &str, data: (String, u32)) {
    env.events().publish(
        (String::from_str(SYSTEM_TOPIC), String::from_str(event_type)),
        data
    );
}

pub fn publish_plan_event(env: &Env, event_type: &str, data: (String, Uint128, u64)) {
    env.events().publish(
        (String::from_str(PLAN_TOPIC), String::from_str(event_type)),
        data
    );
}

pub fn publish_subscription_event(env: &Env, event_type: &str, data: (Address, String, String)) {
    env.events().publish(
        (String::from_str(SUBSCRIPTION_TOPIC), String::from_str(event_type)),
        data
    );
}

pub fn publish_payment_event(env: &Env, event_type: &str, data: (String, Uint128, Address)) {
    env.events().publish(
        (String::from_str(PAYMENT_TOPIC), String::from_str(event_type)),
        data
    );
}
