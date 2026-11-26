// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

use soroban_sdk::{vec, Address, Env};

use crate::types::{BucketNode, DataKey, InstanceKey, Order, OrderStatus, PriceLevel, Side};

pub const NULL_IDX: u32 = u32::MAX;

// ── Instance storage ──────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&InstanceKey::Admin)
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&InstanceKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&InstanceKey::Admin, admin);
}

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&InstanceKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&InstanceKey::Paused, &paused);
}

pub fn get_order_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&InstanceKey::OrderCount)
        .unwrap_or(0u64)
}

pub fn set_order_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&InstanceKey::OrderCount, &count);
}

pub fn get_total_volume(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&InstanceKey::TotalVolume)
        .unwrap_or(0i128)
}

pub fn add_total_volume(env: &Env, amount: i128) {
    let v = get_total_volume(env);
    env.storage()
        .instance()
        .set(&InstanceKey::TotalVolume, &(v + amount));
}

pub fn get_best_price(env: &Env, side: Side) -> i128 {
    let key = match side {
        Side::Buy => InstanceKey::BestBid,
        Side::Sell => InstanceKey::BestAsk,
    };
    env.storage().instance().get(&key).unwrap_or(0i128)
}

pub fn set_best_price(env: &Env, side: Side, price: i128) {
    let key = match side {
        Side::Buy => InstanceKey::BestBid,
        Side::Sell => InstanceKey::BestAsk,
    };
    env.storage().instance().set(&key, &price);
}

// ── Persistent storage ────────────────────────────────────────────────────────

/// Retrieves an order and synchronizes its remaining quantity/status from its
/// active price-level bucket node if the order is currently resting in the book.
pub fn get_order(env: &Env, id: u64) -> Option<Order> {
    let mut order: Order = env.storage().persistent().get(&DataKey::Order(id))?;
    if order.status == OrderStatus::Open || order.status == OrderStatus::PartiallyFilled {
        if let Some(idx) = get_order_index(env, id) {
            let mut live = false;
            if let Some(level) = get_price_level(env, order.side, order.price) {
                if let Some(node) = level.nodes.get(idx) {
                    if node.order_id == id && node.remaining > 0 {
                        live = true;
                        order.remaining = node.remaining;
                        order.status = if node.remaining < order.quantity {
                            OrderStatus::PartiallyFilled
                        } else {
                            OrderStatus::Open
                        };
                    }
                }
            }
            if !live {
                order.remaining = 0;
                order.status = OrderStatus::Filled;
            }
        } else {
            order.remaining = 0;
            order.status = OrderStatus::Filled;
        }
    }
    Some(order)
}

pub fn get_raw_order(env: &Env, id: u64) -> Option<Order> {
    env.storage().persistent().get(&DataKey::Order(id))
}

pub fn set_order(env: &Env, order: &Order) {
    env.storage()
        .persistent()
        .set(&DataKey::Order(order.id), order);
}

pub fn get_order_index(env: &Env, id: u64) -> Option<u32> {
    env.storage().temporary().get(&DataKey::OrderIndex(id))
}

pub fn set_order_index(env: &Env, id: u64, idx: u32) {
    env.storage()
        .temporary()
        .set(&DataKey::OrderIndex(id), &idx);
}

pub fn remove_order_index(env: &Env, id: u64) {
    env.storage().temporary().remove(&DataKey::OrderIndex(id));
}

pub fn get_price_level(env: &Env, side: Side, price: i128) -> Option<PriceLevel> {
    env.storage()
        .temporary()
        .get(&DataKey::PriceLevel(side, price))
}

pub fn set_price_level(env: &Env, side: Side, price: i128, level: &PriceLevel) {
    env.storage()
        .temporary()
        .set(&DataKey::PriceLevel(side, price), level);
}

pub fn remove_price_level(env: &Env, side: Side, price: i128) {
    env.storage()
        .temporary()
        .remove(&DataKey::PriceLevel(side, price));
}

// ── Bucketed Price-Level & Linked-List Queue Operations ───────────────────────

fn is_better_price(side: Side, candidate: i128, current: i128) -> bool {
    match side {
        Side::Buy => candidate > current,
        Side::Sell => candidate < current,
    }
}

/// Enqueue a resting order at the tail of its price-level FIFO bucket,
/// inserting the price level into the sorted price-level doubly-linked list if new.
pub fn enqueue_order(env: &Env, order: &Order) {
    if let Some(idx) = get_order_index(env, order.id) {
        if let Some(mut level) = get_price_level(env, order.side, order.price) {
            if let Some(mut node) = level.nodes.get(idx) {
                if node.order_id == order.id {
                    node.remaining = order.remaining;
                    level.nodes.set(idx, node);
                    set_price_level(env, order.side, order.price, &level);
                }
            }
        }
        return;
    }

    let side = order.side;
    let price = order.price;

    if let Some(mut level) = get_price_level(env, side, price) {
        let new_idx = level.nodes.len();
        let old_tail = level.tail_idx;
        if old_tail != NULL_IDX {
            let mut tail_node = level.nodes.get(old_tail).unwrap();
            tail_node.next_idx = new_idx;
            level.nodes.set(old_tail, tail_node);
        } else {
            level.head_idx = new_idx;
        }
        level.tail_idx = new_idx;
        level.nodes.push_back(BucketNode {
            order_id: order.id,
            remaining: order.remaining,
            prev_idx: old_tail,
            next_idx: NULL_IDX,
        });
        set_price_level(env, side, price, &level);
        set_order_index(env, order.id, new_idx);
        return;
    }

    // New price level: insert into the side's sorted price-level linked list.
    let best_price = get_best_price(env, side);
    let mut prev_price = 0i128;
    let mut next_price = 0i128;

    if best_price == 0 {
        set_best_price(env, side, price);
    } else if is_better_price(side, price, best_price) {
        next_price = best_price;
        if let Some(mut old_best_level) = get_price_level(env, side, best_price) {
            old_best_level.prev_price = price;
            set_price_level(env, side, best_price, &old_best_level);
        }
        set_best_price(env, side, price);
    } else {
        let mut curr = best_price;
        loop {
            let curr_level = get_price_level(env, side, curr).unwrap();
            let nxt = curr_level.next_price;
            if nxt == 0 || is_better_price(side, price, nxt) {
                prev_price = curr;
                next_price = nxt;
                break;
            }
            curr = nxt;
        }

        if let Some(mut prev_level) = get_price_level(env, side, prev_price) {
            prev_level.next_price = price;
            set_price_level(env, side, prev_price, &prev_level);
        }
        if next_price != 0 {
            if let Some(mut next_level) = get_price_level(env, side, next_price) {
                next_level.prev_price = price;
                set_price_level(env, side, next_price, &next_level);
            }
        }
    }

    let nodes = vec![&env,
        BucketNode {
            order_id: order.id,
            remaining: order.remaining,
            prev_idx: NULL_IDX,
            next_idx: NULL_IDX,
        },
    ];

    let new_level = PriceLevel {
        head_idx: 0,
        tail_idx: 0,
        prev_price,
        next_price,
        nodes,
    };
    set_price_level(env, side, price, &new_level);
    set_order_index(env, order.id, 0);
}

/// Remove an order from its price-level FIFO queue in O(1) time using its
/// linked-list node index and unlink the price level bucket if empty.
pub fn unlink_order(env: &Env, order: &Order) {
    let idx = match get_order_index(env, order.id) {
        Some(i) => i,
        None => return,
    };
    remove_order_index(env, order.id);

    let side = order.side;
    let price = order.price;
    let mut level = match get_price_level(env, side, price) {
        Some(lvl) => lvl,
        None => return,
    };

    let mut node = match level.nodes.get(idx) {
        Some(n) => n,
        None => return,
    };
    let prev_idx = node.prev_idx;
    let next_idx = node.next_idx;
    node.remaining = 0;
    node.prev_idx = NULL_IDX;
    node.next_idx = NULL_IDX;
    level.nodes.set(idx, node);

    if prev_idx != NULL_IDX {
        if let Some(mut prev_node) = level.nodes.get(prev_idx) {
            prev_node.next_idx = next_idx;
            level.nodes.set(prev_idx, prev_node);
        }
    } else {
        level.head_idx = next_idx;
    }

    if next_idx != NULL_IDX {
        if let Some(mut next_node) = level.nodes.get(next_idx) {
            next_node.prev_idx = prev_idx;
            level.nodes.set(next_idx, next_node);
        }
    } else {
        level.tail_idx = prev_idx;
    }

    if level.head_idx == NULL_IDX {
        let prev_exists = level.prev_price != 0 && get_price_level(env, side, level.prev_price).is_some();
        if prev_exists {
            if let Some(mut prev_lvl) = get_price_level(env, side, level.prev_price) {
                prev_lvl.next_price = level.next_price;
                set_price_level(env, side, level.prev_price, &prev_lvl);
            }
        } else {
            set_best_price(env, side, level.next_price);
        }

        if level.next_price != 0 {
            if let Some(mut next_lvl) = get_price_level(env, side, level.next_price) {
                next_lvl.prev_price = level.prev_price;
                set_price_level(env, side, level.next_price, &next_lvl);
            }
        }

        remove_price_level(env, side, price);
    } else {
        set_price_level(env, side, price, &level);
    }
}
