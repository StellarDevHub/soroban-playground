// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LiquidationAuction {
    pub id: u64,
    pub borrower: Address,
    pub collateral_lot: i128,
    pub collateral_remaining: i128,
    pub debt_to_cover: i128,
    pub debt_remaining: i128,
    pub start_time: u64,
    pub duration: u64,
    pub start_price: i128,
    pub reserve_price: i128,
    pub settled: bool,
    pub socialized: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuctionBuyResult {
    pub auction_id: u64,
    pub collateral_bought: i128,
    pub cost_paid: i128,
    pub price_per_unit: i128,
    pub debt_remaining: i128,
    pub collateral_remaining: i128,
    pub settled: bool,
}

/// Calculate MakerDAO Liquidation 2.0-style continuous linear price decay:
/// P(t) = start_price - (start_price - reserve_price) * min(t, duration) / duration
pub fn calculate_dutch_price(
    start_price: i128,
    reserve_price: i128,
    elapsed: u64,
    duration: u64,
) -> i128 {
    if duration == 0 || elapsed >= duration {
        return reserve_price;
    }
    if elapsed == 0 {
        return start_price;
    }

    let price_delta = start_price.saturating_sub(reserve_price);
    let decay = price_delta
        .saturating_mul(elapsed as i128)
        .checked_div(duration as i128)
        .unwrap_or(0);

    start_price.saturating_sub(decay).max(reserve_price)
}
