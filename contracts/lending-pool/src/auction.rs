// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Two-Phase Collateralized Debt Auction & Bad-Debt Socialization
//!
//! Provides a two-phase auction protocol (Phase 1: English ascending bid,
//! Phase 2: Dutch continuous linear price decay) to liquidate undercollateralized
//! debt positions during market downturns, with stability pool fallback for unbid auctions.

use soroban_sdk::{contracttype, symbol_short, Address, Env};

use crate::{
    get_bad_debt, get_position, get_total_borrowed, set_bad_debt, set_position, set_total_borrowed,
    Error,
};

// ── Auction Constants ─────────────────────────────────────────────────────────

pub const DEFAULT_ENGLISH_DURATION: u64 = 1800; // 30 minutes
pub const DEFAULT_DUTCH_DURATION: u64 = 3600; // 60 minutes
pub const MIN_BID_INCREMENT_BPS: i128 = 500; // 5% minimum increment

// ── Types ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum AuctionPhase {
    English = 1,
    Dutch = 2,
    Settled = 3,
    Socialized = 4,
    Cancelled = 5,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Auction {
    pub id: u64,
    pub vault_id: u64,
    pub borrower: Address,
    pub debt_amount: i128,
    pub collateral_amount: i128,
    pub start_time: u64,
    pub english_duration: u64,
    pub dutch_duration: u64,
    pub start_price: i128,
    pub reserve_price: i128,
    pub highest_bidder: Option<Address>,
    pub highest_bid: i128,
    pub phase: AuctionPhase,
}

// ── Storage Helpers ───────────────────────────────────────────────────────────

pub fn get_next_auction_id(env: &Env) -> u64 {
    let current = env
        .storage()
        .instance()
        .get::<_, u64>(&symbol_short!("auct_cnt"))
        .unwrap_or(0);
    let next = current + 1;
    env.storage()
        .instance()
        .set(&symbol_short!("auct_cnt"), &next);
    next
}

pub fn get_auction_storage(env: &Env, auction_id: u64) -> Result<Auction, Error> {
    env.storage()
        .persistent()
        .get(&(symbol_short!("auct"), auction_id))
        .ok_or(Error::AuctionNotFound)
}

pub fn set_auction_storage(env: &Env, auction: &Auction) {
    env.storage()
        .persistent()
        .set(&(symbol_short!("auct"), auction.id), auction);
}

pub fn set_vault_owner(env: &Env, vault_id: u64, owner: &Address) {
    env.storage()
        .persistent()
        .set(&(symbol_short!("vault"), vault_id), owner);
}

pub fn get_vault_owner(env: &Env, vault_id: u64) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&(symbol_short!("vault"), vault_id))
}

pub fn get_stability_pool_total(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get::<_, i128>(&symbol_short!("stab_tot"))
        .unwrap_or(0)
}

pub fn set_stability_pool_total(env: &Env, val: i128) {
    env.storage()
        .instance()
        .set(&symbol_short!("stab_tot"), &val);
}

pub fn get_user_stability_balance(env: &Env, user: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&(symbol_short!("stab_usr"), user.clone()))
        .unwrap_or(0)
}

pub fn set_user_stability_balance(env: &Env, user: &Address, val: i128) {
    env.storage()
        .persistent()
        .set(&(symbol_short!("stab_usr"), user.clone()), &val);
}

// ── Price Calculation & Phase Logic ───────────────────────────────────────────

/// Calculate Dutch continuous linear decay price:
/// P(t) = start_price - (start_price - reserve_price) * (t - start_dutch) / dutch_duration
pub fn calculate_dutch_price(
    start_price: i128,
    reserve_price: i128,
    elapsed_in_dutch: u64,
    dutch_duration: u64,
) -> i128 {
    if dutch_duration == 0 || elapsed_in_dutch >= dutch_duration {
        return reserve_price;
    }
    if elapsed_in_dutch == 0 {
        return start_price;
    }

    let price_delta = start_price.saturating_sub(reserve_price);
    let decay = price_delta
        .saturating_mul(elapsed_in_dutch as i128)
        .checked_div(dutch_duration as i128)
        .unwrap_or(0);

    start_price.saturating_sub(decay).max(reserve_price)
}

/// Computes the active phase based on ledger timestamp and auction state
pub fn compute_auction_phase(auction: &Auction, current_time: u64) -> AuctionPhase {
    if auction.phase == AuctionPhase::Settled
        || auction.phase == AuctionPhase::Socialized
        || auction.phase == AuctionPhase::Cancelled
    {
        return auction.phase;
    }

    let english_end = auction.start_time.saturating_add(auction.english_duration);
    if current_time < english_end {
        AuctionPhase::English
    } else {
        AuctionPhase::Dutch
    }
}

/// Computes current asking price for the auction
pub fn compute_auction_price(auction: &Auction, current_time: u64) -> i128 {
    let phase = compute_auction_phase(auction, current_time);
    match phase {
        AuctionPhase::English => {
            if auction.highest_bid > 0 {
                auction.highest_bid
            } else {
                auction.start_price
            }
        }
        AuctionPhase::Dutch => {
            let english_end = auction.start_time.saturating_add(auction.english_duration);
            let elapsed_dutch = current_time.saturating_sub(english_end);
            calculate_dutch_price(
                auction.start_price,
                auction.reserve_price,
                elapsed_dutch,
                auction.dutch_duration,
            )
        }
        _ => auction.reserve_price,
    }
}

// ── Core Protocol Implementation ──────────────────────────────────────────────

pub fn kick_liquidation_auction_impl(
    env: &Env,
    vault_id: u64,
    bad_debt: i128,
) -> Result<u64, Error> {
    if bad_debt <= 0 {
        return Err(Error::InvalidAmount);
    }

    let borrower = get_vault_owner(env, vault_id).unwrap_or_else(|| {
        // Fallback default address if vault_id not separately registered
        env.current_contract_address()
    });

    let mut borrower_pos = get_position(env, &borrower);
    let collateral_to_seize = if borrower_pos.deposited > 0 {
        let amt = borrower_pos.deposited.min(bad_debt.saturating_mul(12) / 10);
        borrower_pos.deposited = borrower_pos.deposited.saturating_sub(amt);
        set_position(env, &borrower, &borrower_pos);
        amt
    } else {
        bad_debt
    };

    let start_price = bad_debt.saturating_mul(12) / 10; // 120% starting price
    let reserve_price = bad_debt.saturating_mul(6) / 10; // 60% reserve price floor

    let auction_id = get_next_auction_id(env);
    let start_time = env.ledger().timestamp();

    let auction = Auction {
        id: auction_id,
        vault_id,
        borrower,
        debt_amount: bad_debt,
        collateral_amount: collateral_to_seize,
        start_time,
        english_duration: DEFAULT_ENGLISH_DURATION,
        dutch_duration: DEFAULT_DUTCH_DURATION,
        start_price,
        reserve_price,
        highest_bidder: None,
        highest_bid: 0,
        phase: AuctionPhase::English,
    };

    set_auction_storage(env, &auction);

    env.events().publish(
        (symbol_short!("kick_auc"), vault_id),
        (auction_id, bad_debt, collateral_to_seize),
    );

    Ok(auction_id)
}

pub fn kick_auction_detailed_impl(
    env: &Env,
    caller: &Address,
    vault_id: u64,
    borrower: &Address,
    debt_amount: i128,
    collateral_amount: i128,
    start_price: i128,
    reserve_price: i128,
    english_duration: u64,
    dutch_duration: u64,
) -> Result<u64, Error> {
    if debt_amount <= 0 || collateral_amount <= 0 || start_price <= 0 || reserve_price <= 0 {
        return Err(Error::InvalidAmount);
    }
    if reserve_price > start_price {
        return Err(Error::InvalidAmount);
    }

    caller.require_auth();

    let mut borrower_pos = get_position(env, borrower);
    if borrower_pos.deposited < collateral_amount {
        return Err(Error::InsufficientCollateral);
    }

    borrower_pos.deposited = borrower_pos
        .deposited
        .checked_sub(collateral_amount)
        .ok_or(Error::Overflow)?;
    borrower_pos.last_updated = env.ledger().timestamp();
    set_position(env, borrower, &borrower_pos);

    let auction_id = get_next_auction_id(env);
    let start_time = env.ledger().timestamp();

    set_vault_owner(env, vault_id, borrower);

    let auction = Auction {
        id: auction_id,
        vault_id,
        borrower: borrower.clone(),
        debt_amount,
        collateral_amount,
        start_time,
        english_duration,
        dutch_duration,
        start_price,
        reserve_price,
        highest_bidder: None,
        highest_bid: 0,
        phase: AuctionPhase::English,
    };

    set_auction_storage(env, &auction);

    env.events().publish(
        (symbol_short!("kick_auc"), vault_id),
        (auction_id, debt_amount, collateral_amount),
    );

    Ok(auction_id)
}

pub fn bid_english_impl(
    env: &Env,
    bidder: &Address,
    auction_id: u64,
    amount: i128,
) -> Result<(), Error> {
    bidder.require_auth();
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let mut auction = get_auction_storage(env, auction_id)?;
    let now = env.ledger().timestamp();

    let phase = compute_auction_phase(&auction, now);
    if phase != AuctionPhase::English {
        return Err(Error::InvalidAuctionPhase);
    }

    if auction.highest_bid == 0 {
        if amount < auction.start_price {
            return Err(Error::BidTooLow);
        }
    } else {
        let min_increment = auction
            .highest_bid
            .checked_mul(MIN_BID_INCREMENT_BPS)
            .ok_or(Error::Overflow)?
            .checked_div(10_000)
            .ok_or(Error::Overflow)?;
        let min_required = auction
            .highest_bid
            .checked_add(min_increment)
            .ok_or(Error::Overflow)?;
        if amount < min_required {
            return Err(Error::BidTooLow);
        }
    }

    // Refund previous bidder deposit if any
    if let Some(ref prev_bidder) = auction.highest_bidder {
        let mut prev_pos = get_position(env, prev_bidder);
        prev_pos.deposited = prev_pos
            .deposited
            .checked_add(auction.highest_bid)
            .ok_or(Error::Overflow)?;
        set_position(env, prev_bidder, &prev_pos);
    }

    // Lock new bidder deposit
    let mut bidder_pos = get_position(env, bidder);
    if bidder_pos.deposited < amount {
        return Err(Error::InsufficientBalance);
    }
    bidder_pos.deposited = bidder_pos
        .deposited
        .checked_sub(amount)
        .ok_or(Error::Overflow)?;
    set_position(env, bidder, &bidder_pos);

    auction.highest_bidder = Some(bidder.clone());
    auction.highest_bid = amount;
    set_auction_storage(env, &auction);

    env.events().publish(
        (symbol_short!("bid_eng"), auction_id),
        (bidder.clone(), amount),
    );

    Ok(())
}

pub fn settle_english_auction_impl(env: &Env, auction_id: u64) -> Result<(), Error> {
    let mut auction = get_auction_storage(env, auction_id)?;
    if auction.phase == AuctionPhase::Settled || auction.phase == AuctionPhase::Socialized {
        return Err(Error::AuctionAlreadySettled);
    }

    let now = env.ledger().timestamp();
    let english_end = auction.start_time.saturating_add(auction.english_duration);
    if now < english_end {
        return Err(Error::AuctionNotExpired);
    }

    let highest_bidder = match auction.highest_bidder {
        Some(ref b) => b.clone(),
        None => return Err(Error::InvalidAuctionPhase),
    };

    let bid_amount = auction.highest_bid;
    let debt_burned = bid_amount.min(auction.debt_amount);

    // Atomic debt burn
    let mut borrower_pos = get_position(env, &auction.borrower);
    borrower_pos.borrowed = borrower_pos.borrowed.saturating_sub(debt_burned);
    set_position(env, &auction.borrower, &borrower_pos);

    let new_total_borrowed = get_total_borrowed(env).saturating_sub(debt_burned);
    set_total_borrowed(env, new_total_borrowed);

    // Deliver collateral to winner
    let mut winner_pos = get_position(env, &highest_bidder);
    winner_pos.deposited = winner_pos
        .deposited
        .checked_add(auction.collateral_amount)
        .ok_or(Error::Overflow)?;
    set_position(env, &highest_bidder, &winner_pos);

    // If bid was insufficient to cover full debt, record bad debt deficit
    if auction.debt_amount > debt_burned {
        let deficit = auction.debt_amount - debt_burned;
        let current_bad_debt = get_bad_debt(env);
        set_bad_debt(env, current_bad_debt.saturating_add(deficit));
    }

    auction.phase = AuctionPhase::Settled;
    set_auction_storage(env, &auction);

    env.events().publish(
        (symbol_short!("set_eng"), auction_id),
        (highest_bidder, bid_amount, auction.collateral_amount),
    );

    Ok(())
}

pub fn buy_dutch_impl(
    env: &Env,
    bidder: &Address,
    auction_id: u64,
    max_price: i128,
) -> Result<i128, Error> {
    bidder.require_auth();
    let mut auction = get_auction_storage(env, auction_id)?;
    if auction.phase == AuctionPhase::Settled || auction.phase == AuctionPhase::Socialized {
        return Err(Error::AuctionAlreadySettled);
    }

    let now = env.ledger().timestamp();
    let phase = compute_auction_phase(&auction, now);
    if phase != AuctionPhase::Dutch {
        return Err(Error::InvalidAuctionPhase);
    }

    let current_price = compute_auction_price(&auction, now);
    if current_price > max_price {
        return Err(Error::PriceExceedsMax);
    }

    // Bidder pays current_price from their deposit
    let mut bidder_pos = get_position(env, bidder);
    if bidder_pos.deposited < current_price {
        return Err(Error::InsufficientBalance);
    }
    bidder_pos.deposited = bidder_pos
        .deposited
        .checked_sub(current_price)
        .ok_or(Error::Overflow)?;

    // Deliver collateral to bidder
    bidder_pos.deposited = bidder_pos
        .deposited
        .checked_add(auction.collateral_amount)
        .ok_or(Error::Overflow)?;
    set_position(env, bidder, &bidder_pos);

    // Atomic debt burn
    let debt_burned = current_price.min(auction.debt_amount);
    let mut borrower_pos = get_position(env, &auction.borrower);
    borrower_pos.borrowed = borrower_pos.borrowed.saturating_sub(debt_burned);
    set_position(env, &auction.borrower, &borrower_pos);

    let new_total_borrowed = get_total_borrowed(env).saturating_sub(debt_burned);
    set_total_borrowed(env, new_total_borrowed);

    // Socialize remaining bad debt deficit if purchase price was below debt
    if auction.debt_amount > debt_burned {
        let deficit = auction.debt_amount - debt_burned;
        let current_bad_debt = get_bad_debt(env);
        set_bad_debt(env, current_bad_debt.saturating_add(deficit));
    }

    auction.phase = AuctionPhase::Settled;
    set_auction_storage(env, &auction);

    env.events().publish(
        (symbol_short!("buy_dutch"), auction_id),
        (bidder.clone(), current_price, auction.collateral_amount),
    );

    Ok(current_price)
}

// ── Secondary Stability Pool & Fallback Socialization ─────────────────────────

pub fn deposit_stability_pool_impl(
    env: &Env,
    depositor: &Address,
    amount: i128,
) -> Result<(), Error> {
    depositor.require_auth();
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let mut user_pos = get_position(env, depositor);
    if user_pos.deposited < amount {
        return Err(Error::InsufficientBalance);
    }
    user_pos.deposited = user_pos
        .deposited
        .checked_sub(amount)
        .ok_or(Error::Overflow)?;
    set_position(env, depositor, &user_pos);

    let user_stab = get_user_stability_balance(env, depositor);
    set_user_stability_balance(env, depositor, user_stab.saturating_add(amount));

    let pool_total = get_stability_pool_total(env);
    set_stability_pool_total(env, pool_total.saturating_add(amount));

    env.events()
        .publish((symbol_short!("stab_dep"), depositor.clone()), amount);

    Ok(())
}

pub fn withdraw_stability_pool_impl(
    env: &Env,
    depositor: &Address,
    amount: i128,
) -> Result<(), Error> {
    depositor.require_auth();
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let user_stab = get_user_stability_balance(env, depositor);
    if user_stab < amount {
        return Err(Error::InsufficientBalance);
    }

    set_user_stability_balance(env, depositor, user_stab.saturating_sub(amount));

    let pool_total = get_stability_pool_total(env);
    set_stability_pool_total(env, pool_total.saturating_sub(amount));

    let mut user_pos = get_position(env, depositor);
    user_pos.deposited = user_pos
        .deposited
        .checked_add(amount)
        .ok_or(Error::Overflow)?;
    set_position(env, depositor, &user_pos);

    env.events()
        .publish((symbol_short!("stab_wth"), depositor.clone()), amount);

    Ok(())
}

pub fn socialize_unbid_auction_impl(
    env: &Env,
    caller: &Address,
    auction_id: u64,
) -> Result<(), Error> {
    caller.require_auth();
    let mut auction = get_auction_storage(env, auction_id)?;
    if auction.phase == AuctionPhase::Settled || auction.phase == AuctionPhase::Socialized {
        return Err(Error::AuctionAlreadySettled);
    }

    let now = env.ledger().timestamp();
    let total_duration = auction
        .start_time
        .saturating_add(auction.english_duration)
        .saturating_add(auction.dutch_duration);

    if now < total_duration {
        return Err(Error::AuctionNotExpired);
    }

    let bad_debt = auction.debt_amount;
    let stability_pool_total = get_stability_pool_total(env);

    let covered_by_stability = bad_debt.min(stability_pool_total);
    let remaining_deficit = bad_debt.saturating_sub(covered_by_stability);

    // Drain stability pool for covered portion
    if covered_by_stability > 0 {
        set_stability_pool_total(
            env,
            stability_pool_total.saturating_sub(covered_by_stability),
        );
    }

    // Socialize remaining deficit into global bad debt accumulator
    if remaining_deficit > 0 {
        let current_bad_debt = get_bad_debt(env);
        set_bad_debt(env, current_bad_debt.saturating_add(remaining_deficit));
    }

    // Atomic debt burn
    let mut borrower_pos = get_position(env, &auction.borrower);
    borrower_pos.borrowed = borrower_pos.borrowed.saturating_sub(bad_debt);
    set_position(env, &auction.borrower, &borrower_pos);

    let new_total_borrowed = get_total_borrowed(env).saturating_sub(bad_debt);
    set_total_borrowed(env, new_total_borrowed);

    auction.phase = AuctionPhase::Socialized;
    set_auction_storage(env, &auction);

    env.events().publish(
        (symbol_short!("soc_unbid"), auction_id),
        (bad_debt, covered_by_stability, remaining_deficit),
    );

    Ok(())
}
