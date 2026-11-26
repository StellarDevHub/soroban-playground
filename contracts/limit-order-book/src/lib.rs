// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

//! # Limit Order Book
//!
//! On-chain limit order book with price-time priority matching:
//! - Place buy/sell limit orders with price and quantity.
//! - Bucketed price-level queues with linked-list order indices.
//! - Automatic matching: best bid meets best ask (strict price-time priority).
//! - Capped maximum matched fills per transaction (`MAX_MATCHED_FILLS`).
//! - Partial fills supported; orders remain open until fully filled or cancelled.
//! - Admin-controlled emergency pause/unpause.
//! - Comprehensive event emissions for all state changes.

#![no_std]

mod storage;
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, symbol_short, vec, Address, Env, Vec};

use crate::storage::{
    add_total_volume, enqueue_order, get_admin, get_best_price, get_order, get_raw_order, get_order_count,
    get_price_level, is_initialized, is_paused, remove_price_level, set_admin,
    set_best_price, set_order, set_order_count, set_paused, set_price_level, unlink_order,
    NULL_IDX,
};
use crate::types::{Error, Order, OrderStatus, Side, Trade, MAX_MATCHED_FILLS, DataKey};

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
        set_best_price(&env, Side::Buy, 0);
        set_best_price(&env, Side::Sell, 0);
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
            side,
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
        // Attempt immediate matching (enqueues remaining quantity into bucketed price-level queue)
        Self::try_match(&env, id)?;


        Ok(id)
    }

    /// Cancel an open or partially-filled order and unlink it from its price-level queue.
    /// Cancel an open or partially-filled order and unlink it from its price-level queue.
    pub fn cancel_order(env: Env, owner: Address, order_id: u64) -> Result<(), Error> {
        owner.require_auth();
        let mut order = get_order(&env, order_id).ok_or(Error::OrderNotFound)?;
        if order.owner != owner {
            return Err(Error::NotOrderOwner);
        }
        if order.status == OrderStatus::Filled || order.status == OrderStatus::Cancelled {
            return Err(Error::OrderInactive);
        }
        // Unlink order from its price level bucket.
        unlink_order(&env, &order);
        order.status = OrderStatus::Cancelled;
        set_order(&env, &order);
        env.events().publish((symbol_short!("cancelled"),), (order_id,));
        Ok(())
    }

    // ── Matching engine ───────────────────────────────────────────────────────

    /// Attempt to match order `aggressor_id` against resting orders in strict
    /// price-time priority, capped at `MAX_MATCHED_FILLS` per invocation.
    pub fn match_order(env: Env, aggressor_id: u64) -> Result<Vec<Trade>, Error> {
        Self::assert_not_paused(&env)?;
        Self::try_match(&env, aggressor_id)
    }

    /// Alias for `match_order` matching the `match_orders(env, order_id)` signature.
    pub fn match_orders(env: Env, order_id: u64) -> Result<Vec<Trade>, Error> {
        Self::assert_not_paused(&env)?;
        Self::try_match(&env, order_id)
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

    pub fn best_bid(env: Env) -> i128 {
        get_best_price(&env, Side::Buy)
    }

    pub fn best_ask(env: Env) -> i128 {
        get_best_price(&env, Side::Sell)
    }

    // View to expose current matched fills counter (used by benchmark test).
    pub fn matched_fills(env: Env) -> u32 {
        env.storage()
            .temporary()
            .get(&DataKey::MatchedFills)
            .unwrap_or(0u32)
    }

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

    /// Core matching logic: O(1) per-fill traversal of bucketed price-level FIFO queues
    /// with linked-list order indices. Enforces strict price-time priority and caps fills
    /// at `MAX_MATCHED_FILLS`.
    pub(crate) fn try_match(env: &Env, aggressor_id: u64) -> Result<Vec<Trade>, Error> {
        let mut aggressor = match get_raw_order(env, aggressor_id) {
            Some(o) => o,
            None => return Err(Error::OrderNotFound),
        };

        if aggressor.status == OrderStatus::Filled || aggressor.status == OrderStatus::Cancelled {
            return Ok(vec![env]);
        }

        let opposite_side = match aggressor.side {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        };

        let mut trades: Vec<Trade> = vec![env];
        let mut fills: u32 = 0;
        // Reset temporary fill counter for this transaction.
        env.storage().temporary().set(&DataKey::MatchedFills, &0u32);
        let mut total_matched_volume: i128 = 0;
        let ledger_seq = env.ledger().sequence();


        let mut best_opp_price = get_best_price(env, opposite_side);
        let initial_best_opp_price = best_opp_price;

        while aggressor.remaining > 0 && fills < MAX_MATCHED_FILLS && best_opp_price != 0 {
            let price_crosses = match aggressor.side {
                Side::Buy => aggressor.price >= best_opp_price,
                Side::Sell => aggressor.price <= best_opp_price,
            };
            if !price_crosses {
                break;
            }

            let mut level = match get_price_level(env, opposite_side, best_opp_price) {
                Some(lvl) => lvl,
                None => {
                    best_opp_price = 0;
                    break;
                }
            };

            let exec_price = best_opp_price;


            let mut cur = level.nodes.get(level.head_idx);
            let mut head_changed = false;
            while aggressor.remaining > 0
                && fills < MAX_MATCHED_FILLS
                && level.head_idx != NULL_IDX
            {
                let head_idx = level.head_idx;
                let mut node = match cur.take() {
                    Some(n) => n,
                    None => break,
                };
                let resting_id = node.order_id;
                let fill_qty = aggressor.remaining.min(node.remaining);

                aggressor.remaining -= fill_qty;
                node.remaining -= fill_qty;
                aggressor.status = if aggressor.remaining == 0 {
                    OrderStatus::Filled
                } else {
                    OrderStatus::PartiallyFilled
                };

                if node.remaining == 0 {
                    let next_idx = node.next_idx;
                    level.nodes.set(head_idx, node);
                    level.head_idx = next_idx;
                    if next_idx != NULL_IDX {
                        cur = level.nodes.get(next_idx);
                        head_changed = true;
                    } else {
                        level.tail_idx = NULL_IDX;
                    }
                } else {
                    level.nodes.set(head_idx, node);
                }

                total_matched_volume += fill_qty;
                fills += 1;

                let (buy_id, sell_id) = match aggressor.side {
                    Side::Buy => (aggressor_id, resting_id),
                    Side::Sell => (resting_id, aggressor_id),
                };
                trades.push_back(Trade {
                    buy_order_id: buy_id,
                    sell_order_id: sell_id,
                    price: exec_price,
                    quantity: fill_qty,
                    executed_at: ledger_seq,
                });
            }
            if head_changed && level.head_idx != NULL_IDX {
                if let Some(mut hn) = level.nodes.get(level.head_idx) {
                    hn.prev_idx = NULL_IDX;
                    level.nodes.set(level.head_idx, hn);
                }
            }

            if level.head_idx == NULL_IDX {
                let next_p = level.next_price;
                remove_price_level(env, opposite_side, best_opp_price);
                best_opp_price = next_p;
            } else {
                set_price_level(env, opposite_side, best_opp_price, &level);
                break;
            }
        }

        if best_opp_price != initial_best_opp_price {
            set_best_price(env, opposite_side, best_opp_price);
        }

        if total_matched_volume > 0 {

            add_total_volume(env, total_matched_volume);

            env.storage().temporary().set(&DataKey::MatchedFills, &fills);
            set_order(env, &aggressor);
        }

        if aggressor.remaining > 0 {
            enqueue_order(env, &aggressor);
        } else {
            unlink_order(env, &aggressor);
        }

        Ok(trades)
    }
}
