// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * In-memory Limit Order Book service.
 * Stores orders and executes price-time priority matching.
 * In production this would persist to a database and sync with the on-chain contract.
 */

let orderIdSeq = 0;
/** @type {Map<number, Order>} */
const orders = new Map();

/**
 * @typedef {Object} Order
 * @property {number} id
 * @property {string} owner
 * @property {'buy'|'sell'} side
 * @property {number} price  - scaled integer (e.g. 1e7 = 1.0)
 * @property {number} quantity
 * @property {number} remaining
 * @property {'open'|'partially_filled'|'filled'|'cancelled'} status
 * @property {number} createdAt - unix ms
 */

/**
 * @typedef {Object} Trade
 * @property {number} buyOrderId
 * @property {number} sellOrderId
 * @property {number} price
 * @property {number} quantity
 * @property {number} executedAt
 */

/** @type {Trade[]} */
const tradeHistory = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchOrders(aggressorId) {
  const aggressor = orders.get(aggressorId);
  if (!aggressor || aggressor.status === 'filled' || aggressor.status === 'cancelled') return [];

  const trades = [];
  // Collect resting orders on the opposite side, sorted by best price then oldest first
  const resting = [...orders.values()]
    .filter(o =>
      o.id !== aggressorId &&
      o.side !== aggressor.side &&
      (o.status === 'open' || o.status === 'partially_filled')
    )
    .sort((a, b) => {
      // For buy aggressor: sort sells ascending (cheapest first)
      // For sell aggressor: sort buys descending (highest first)
      const priceCmp = aggressor.side === 'buy'
        ? a.price - b.price
        : b.price - a.price;
      return priceCmp !== 0 ? priceCmp : a.createdAt - b.createdAt;
    });

  for (const rest of resting) {
    if (aggressor.remaining <= 0) break;

    const priceMatches = aggressor.side === 'buy'
      ? aggressor.price >= rest.price
      : aggressor.price <= rest.price;

    if (!priceMatches) break; // sorted, so no further matches possible

    const fillQty = Math.min(aggressor.remaining, rest.remaining);
    const execPrice = rest.price; // maker price

    aggressor.remaining -= fillQty;
    rest.remaining -= fillQty;

    aggressor.status = aggressor.remaining === 0 ? 'filled' : 'partially_filled';
    rest.status = rest.remaining === 0 ? 'filled' : 'partially_filled';

    const trade = {
      buyOrderId: aggressor.side === 'buy' ? aggressorId : rest.id,
      sellOrderId: aggressor.side === 'sell' ? aggressorId : rest.id,
      price: execPrice,
      quantity: fillQty,
      executedAt: Date.now(),
    };
    tradeHistory.push(trade);
    trades.push(trade);
  }

  return trades;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function placeOrder({ owner, side, price, quantity }) {
  if (!owner || typeof owner !== 'string') throw Object.assign(new Error('owner required'), { status: 400 });
  if (side !== 'buy' && side !== 'sell') throw Object.assign(new Error('side must be buy or sell'), { status: 400 });
  if (!Number.isFinite(price) || price <= 0) throw Object.assign(new Error('price must be a positive number'), { status: 400 });
  if (!Number.isFinite(quantity) || quantity <= 0) throw Object.assign(new Error('quantity must be a positive number'), { status: 400 });

  const id = ++orderIdSeq;
  const order = { id, owner, side, price, quantity, remaining: quantity, status: 'open', createdAt: Date.now() };
  orders.set(id, order);

  const trades = matchOrders(id);
  return { order: orders.get(id), trades };
}

export function cancelOrder(id, owner) {
  const order = orders.get(id);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.owner !== owner) throw Object.assign(new Error('Not order owner'), { status: 403 });
  if (order.status === 'filled' || order.status === 'cancelled') {
    throw Object.assign(new Error('Order is not active'), { status: 409 });
  }
  order.status = 'cancelled';
  return order;
}

export function getOrder(id) {
  const order = orders.get(id);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  return order;
}

export function getOrderBook() {
  const bids = [...orders.values()]
    .filter(o => o.side === 'buy' && (o.status === 'open' || o.status === 'partially_filled'))
    .sort((a, b) => b.price - a.price || a.createdAt - b.createdAt);

  const asks = [...orders.values()]
    .filter(o => o.side === 'sell' && (o.status === 'open' || o.status === 'partially_filled'))
    .sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);

  return { bids, asks };
}

export function getTrades({ limit = 50, offset = 0 } = {}) {
  const slice = tradeHistory.slice().reverse().slice(offset, offset + limit);
  return { trades: slice, total: tradeHistory.length };
}

export function getStats() {
  const allOrders = [...orders.values()];
  return {
    totalOrders: allOrders.length,
    openOrders: allOrders.filter(o => o.status === 'open' || o.status === 'partially_filled').length,
    totalTrades: tradeHistory.length,
    totalVolume: tradeHistory.reduce((s, t) => s + t.quantity, 0),
  };
}

/** Reset state (for tests) */
export function _reset() {
  orderIdSeq = 0;
  orders.clear();
  tradeHistory.length = 0;
}
