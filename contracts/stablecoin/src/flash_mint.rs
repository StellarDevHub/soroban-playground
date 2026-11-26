// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlashMintConfig {
    pub paused: bool,
    pub base_fee_bps: u32,
    pub global_debt_ceiling: i128,
    pub tx_debt_ceiling: i128,
    pub current_flash_debt: i128,
    pub fee_vault: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum FlashMintDataKey {
    FlashMintPaused,
    FlashMintBaseFeeBps,
    FlashMintGlobalDebtCeiling,
    FlashMintTxDebtCeiling,
    FlashMintCurrentDebt,
    FlashMintFeeVault,
    FlashMintReentrancyGuard,
}
