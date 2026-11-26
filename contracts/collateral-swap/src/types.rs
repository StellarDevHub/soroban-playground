// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracterror, contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapParams {
    pub user: Address,
    pub from_collateral: Address,
    pub to_collateral: Address,
    pub from_amount: i128,
    pub flash_borrow_amount: i128,
    pub min_dex_output: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PositionHealth {
    pub collateral_value: i128,
    pub debt_value: i128,
    pub health_factor_bps: i128, // e.g. 15000 = 1.5 HF
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapResult {
    pub from_collateral_withdrawn: i128,
    pub to_collateral_deposited: i128,
    pub flash_loan_repaid: i128,
    pub initial_health_factor: i128,
    pub final_health_factor: i128,
    /// Protocol switching fee charged on the DEX output (denominated in `to_collateral`).
    pub switch_fee: i128,
    /// Deviation (bps) between the DEX rate and the oracle-implied rate for the pair.
    pub price_deviation_bps: i128,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    SlippageExceeded = 5,
    FlashLoanRepaymentFailed = 6,
    HealthFactorDecreased = 7,
    InsolventPosition = 8,
    InsufficientLendingCollateral = 9,
    DexSwapFailed = 10,
    PriceDeviationExceeded = 11,
}
