// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Limit Order Book
//!
//! On-chain limit order book with price-time priority matching:
//! - Place buy/sell limit orders with price and quantity.
//! - Automatic matching: best bid meets best ask (price-time priority).
//! - Partial fills supported; orders remain open until fully filled or cancelled.
//! - Admin-controlled emergency pause/unpause.
//! - Comprehensive event emissions for all state changes.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Env, Vec};

use crate::storage::{
    add_total_volume, get_admin, get_order, get_order_count, is_initialized, is_paused, set_admin,
    set_order, set_order_count, set_paused,
};
use crate::types::{DataKey, Error, InstanceKey, Order, OrderStatus, Side, Trade};

#[contract]
pub struct LimitOrderBookContract;

#[contractimpl]
impl LimitOrderBookContract {
    // ── Initialisation ────────────────────────────────────────────────────────

    /// Initialise the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if is_initialized(&env) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_order_count(&env, 0);
        set_paused(&env, false);
        env.events()
            .publish((symbol_short!("init"),), (admin.clone(),));
        Ok(())
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Pause all order placement and matching. Cancellations remain available.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, true);
        env.events().publish((symbol_short!("paused"),), ());
        Ok(())
    }

    /// Resume normal operation.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        set_paused(&env, false);
        env.events().publish((symbol_short!("unpaused"),), ());
        Ok(())
    }

    /// Transfer admin role.
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        Self::assert_admin(&env, &admin)?;
        new_admin.require_auth();
        set_admin(&env, &new_admin);
        env.events()
            .publish((symbol_short!("newadmin"),), (new_admin,));
        Ok(())
    }

    // ── Order placement ───────────────────────────────────────────────────────

    /// Place a limit order. Returns the new order ID.
    /// Immediately attempts to match against the opposite side.
    pub fn place_order(
        env: Env,
        owner: Address,
        side: Side,
        price: i128,
        quantity: i128,
    ) -> Result<u64, Error> {
        Self::assert_not_paused(&env)?;
        if price <= 0 {
            return Err(Error::ZeroPrice);
        }
        if quantity <= 0 {
            return Err(Error::ZeroAmount);
        }
        owner.require_auth();

        let id = get_order_count(&env) + 1;
        set_order_count(&env, id);

        let order = Order {
            id,
            owner: owner.clone(),
            side: side.clone(),
            price,
            quantity,
            remaining: quantity,
            status: OrderStatus::Open,
            created_at: env.ledger().sequence(),
        };
        set_order(&env, &order);

        env.events().publish(
            (symbol_short!("placed"),),
            (id, owner, side, price, quantity),
        );

        // Attempt immediate matching
        Self::try_match(&env, id)?;

        Ok(id)
    }

    /// Cancel an open or partially-filled order.
    pub fn cancel_order(env: Env, owner: Address, order_id: u64) -> Result<(), Error> {
        owner.require_auth();
        let mut order = get_order(&env, order_id).ok_or(Error::OrderNotFound)?;
        if order.owner != owner {
            return Err(Error::NotOrderOwner);
        }
        if order.status == OrderStatus::Filled || order.status == OrderStatus::Cancelled {
            return Err(Error::OrderInactive);
        }
        order.status = OrderStatus::Cancelled;
        set_order(&env, &order);
        env.events()
            .publish((symbol_short!("cancelled"),), (order_id,));
        Ok(())
    }

    // ── Matching engine ───────────────────────────────────────────────────────

    /// Attempt to match order `aggressor_id` against resting orders.
    /// Scans all orders (gas-bounded to 200 iterations) for the best counterpart.
    pub fn match_order(env: Env, aggressor_id: u64) -> Result<Vec<Trade>, Error> {
        Self::assert_not_paused(&env)?;
        Self::try_match(&env, aggressor_id)
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn get_order(env: Env, order_id: u64) -> Result<Order, Error> {
        get_order(&env, order_id).ok_or(Error::OrderNotFound)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        if !is_initialized(&env) {
            return Err(Error::NotInitialized);
        }
        Ok(get_admin(&env))
    }

    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    pub fn total_volume(env: Env) -> i128 {
        crate::storage::get_total_volume(&env)
    }

    pub fn order_count(env: Env) -> u64 {
        get_order_count(&env)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn assert_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        caller.require_auth();
        if get_admin(env) != *caller {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    fn assert_not_paused(env: &Env) -> Result<(), Error> {
        if !is_initialized(env) {
            return Err(Error::NotInitialized);
        }
        if is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    /// Core matching logic: price-time priority.
    /// Scans up to 200 existing orders for the best resting counterpart.
    fn try_match(env: &Env, aggressor_id: u64) -> Result<Vec<Trade>, Error> {
        let mut aggressor = match get_order(env, aggressor_id) {
            Some(o) => o,
            None => return Err(Error::OrderNotFound),
        };

        if aggressor.status == OrderStatus::Filled
            || aggressor.status == OrderStatus::Cancelled
        {
            return Ok(vec![env]);
        }

        let total = get_order_count(env);
        let mut trades: Vec<Trade> = vec![env];

        // Scan resting orders (oldest first = time priority within same price)
        let scan_limit = total.min(200);
        for resting_id in 1..=scan_limit {
            if aggressor.remaining <= 0 {
                break;
            }
            if resting_id == aggressor_id {
                continue;
            }

            let mut resting = match get_order(env, resting_id) {
                Some(o) => o,
                None => continue,
            };

            if resting.status == OrderStatus::Filled || resting.status == OrderStatus::Cancelled {
                continue;
            }

            // Price check: buy aggressor needs price >= resting sell price
            let price_matches = match aggressor.side {
                Side::Buy => aggressor.price >= resting.price && resting.side == Side::Sell,
                Side::Sell => aggressor.price <= resting.price && resting.side == Side::Buy,
            };

            if !price_matches {
                continue;
            }

            // Execute at resting order's price (maker price)
            let fill_qty = aggressor.remaining.min(resting.remaining);
            let exec_price = resting.price;

            aggressor.remaining -= fill_qty;
            resting.remaining -= fill_qty;

            aggressor.status = if aggressor.remaining == 0 {
                OrderStatus::Filled
            } else {
                OrderStatus::PartiallyFilled
            };
            resting.status = if resting.remaining == 0 {
                OrderStatus::Filled
            } else {
                OrderStatus::PartiallyFilled
            };

            set_order(env, &aggressor);
            set_order(env, &resting);
            add_total_volume(env, fill_qty);

            let (buy_id, sell_id) = match aggressor.side {
                Side::Buy => (aggressor_id, resting_id),
                Side::Sell => (resting_id, aggressor_id),
            };

            let trade = Trade {
                buy_order_id: buy_id,
                sell_order_id: sell_id,
                price: exec_price,
                quantity: fill_qty,
                executed_at: env.ledger().sequence(),
            };

            env.events().publish(
                (symbol_short!("trade"),),
                (buy_id, sell_id, exec_price, fill_qty),
            );

            trades.push_back(trade);
        }

        Ok(trades)
    }
}
