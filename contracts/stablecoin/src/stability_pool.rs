// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StabilityPoolAbsorptionResult {
    pub debt_absorbed: i128,
    pub collateral_rewarded: i128,
    pub remaining_debt: i128,
    pub bad_debt_socialized: i128,
    pub reserve_recovered: i128,
}
