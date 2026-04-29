// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    // System Errors
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ContractPaused = 3,
    Unauthorized = 4,
    InvalidFeeRate = 5,
    
    // Plan Errors
    PlanNotFound = 10,
    PlanAlreadyExists = 11,
    PlanInactive = 12,
    PlanFull = 13,
    InvalidPlanParameters = 14,
    
    // Subscription Errors
    SubscriptionNotFound = 20,
    SubscriptionAlreadyCancelled = 21,
    SubscriptionNotActive = 22,
    AlreadySubscribed = 23,
    RenewalNotDue = 24,
    AutoRenewDisabled = 25,
    
    // Payment Errors
    InsufficientBalance = 30,
    PaymentFailed = 31,
    InvalidPaymentMethod = 32,
    
    // Input Validation Errors
    InvalidAddress = 40,
    InvalidString = 41,
    InvalidNumber = 42,
    EmptyInput = 43,
}
