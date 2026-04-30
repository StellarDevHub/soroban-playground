// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

const { placeOrder, cancelOrder, getOrder, getOrderBook, getTrades, getStats, _reset } =
  await import('../src/services/orderBookService.js');
const { default: orderBookRoute } = await import('../src/routes/orderbook.js');
const { errorHandler } = await import('../src/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/orderbook', orderBookRoute);
app.use(errorHandler);

beforeEach(() => _reset());

// ── Service unit tests ────────────────────────────────────────────────────────

describe('orderBookService', () => {
  describe('placeOrder', () => {
    it('creates a buy order', () => {
      const { order } = placeOrder({ owner: 'alice', side: 'buy', price: 100, quantity: 10 });
      expect(order.id).toBe(1);
      expect(order.status).toBe('open');
      expect(order.remaining).toBe(10);
    });

    it('throws on missing owner', () => {
      expect(() => placeOrder({ side: 'buy', price: 100, quantity: 10 })).toThrow('owner required');
    });

    it('throws on invalid side', () => {
      expect(() => placeOrder({ owner: 'alice', side: 'hold', price: 100, quantity: 10 })).toThrow();
    });

    it('throws on zero price', () => {
      expect(() => placeOrder({ owner: 'alice', side: 'buy', price: 0, quantity: 10 })).toThrow();
    });

    it('throws on zero quantity', () => {
      expect(() => placeOrder({ owner: 'alice', side: 'buy', price: 100, quantity: 0 })).toThrow();
    });
  });

  describe('matching', () => {
    it('fully matches buy against resting sell', () => {
      placeOrder({ owner: 'seller', side: 'sell', price: 100, quantity: 5 });
      const { order, trades } = placeOrder({ owner: 'buyer', side: 'buy', price: 100, quantity: 5 });
      expect(order.status).toBe('filled');
      expect(trades).toHaveLength(1);
      expect(trades[0].quantity).toBe(5);
      expect(trades[0].price).toBe(100);
    });

    it('partially fills when quantities differ', () => {
      placeOrder({ owner: 'seller', side: 'sell', price: 100, quantity: 10 });
      const { order } = placeOrder({ owner: 'buyer', side: 'buy', price: 100, quantity: 4 });
      expect(order.status).toBe('filled');
      expect(getOrder(1).status).toBe('partially_filled');
      expect(getOrder(1).remaining).toBe(6);
    });

    it('does not match when prices do not cross', () => {
      placeOrder({ owner: 'seller', side: 'sell', price: 200, quantity: 5 });
      const { order, trades } = placeOrder({ owner: 'buyer', side: 'buy', price: 100, quantity: 5 });
      expect(order.status).toBe('open');
      expect(trades).toHaveLength(0);
    });

    it('executes at maker (resting) price', () => {
      placeOrder({ owner: 'seller', side: 'sell', price: 90, quantity: 5 });
      const { trades } = placeOrder({ owner: 'buyer', side: 'buy', price: 100, quantity: 5 });
      expect(trades[0].price).toBe(90);
    });
  });

  describe('cancelOrder', () => {
    it('cancels an open order', () => {
      placeOrder({ owner: 'alice', side: 'buy', price: 100, quantity: 5 });
      const order = cancelOrder(1, 'alice');
      expect(order.status).toBe('cancelled');
    });

    it('throws when wrong owner', () => {
      placeOrder({ owner: 'alice', side: 'buy', price: 100, quantity: 5 });
      expect(() => cancelOrder(1, 'bob')).toThrow('Not order owner');
    });

    it('throws when order not found', () => {
      expect(() => cancelOrder(999, 'alice')).toThrow('Order not found');
    });

    it('throws when already cancelled', () => {
      placeOrder({ owner: 'alice', side: 'buy', price: 100, quantity: 5 });
      cancelOrder(1, 'alice');
      expect(() => cancelOrder(1, 'alice')).toThrow('Order is not active');
    });
  });

  describe('getOrderBook', () => {
    it('returns bids sorted descending by price', () => {
      placeOrder({ owner: 'a', side: 'buy', price: 100, quantity: 1 });
      placeOrder({ owner: 'b', side: 'buy', price: 200, quantity: 1 });
      const { bids } = getOrderBook();
      expect(bids[0].price).toBe(200);
      expect(bids[1].price).toBe(100);
    });

    it('returns asks sorted ascending by price', () => {
      placeOrder({ owner: 'a', side: 'sell', price: 200, quantity: 1 });
      placeOrder({ owner: 'b', side: 'sell', price: 100, quantity: 1 });
      const { asks } = getOrderBook();
      expect(asks[0].price).toBe(100);
      expect(asks[1].price).toBe(200);
    });
  });

  describe('getStats', () => {
    it('tracks volume after trades', () => {
      placeOrder({ owner: 'seller', side: 'sell', price: 100, quantity: 5 });
      placeOrder({ owner: 'buyer', side: 'buy', price: 100, quantity: 5 });
      const stats = getStats();
      expect(stats.totalTrades).toBe(1);
      expect(stats.totalVolume).toBe(5);
    });
  });
});

// ── HTTP route tests ──────────────────────────────────────────────────────────

describe('GET /api/orderbook', () => {
  it('returns empty book initially', async () => {
    const res = await request(app).get('/api/orderbook');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bids).toEqual([]);
    expect(res.body.data.asks).toEqual([]);
  });
});

describe('POST /api/orderbook/orders', () => {
  it('places a buy order', async () => {
    const res = await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'alice', side: 'buy', price: 100, quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.order.id).toBe(1);
    expect(res.body.data.order.status).toBe('open');
  });

  it('returns 400 on missing owner', async () => {
    const res = await request(app)
      .post('/api/orderbook/orders')
      .send({ side: 'buy', price: 100, quantity: 5 });
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid side', async () => {
    const res = await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'alice', side: 'hold', price: 100, quantity: 5 });
    expect(res.status).toBe(400);
  });

  it('returns trades when order matches', async () => {
    await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'seller', side: 'sell', price: 100, quantity: 5 });
    const res = await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'buyer', side: 'buy', price: 100, quantity: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data.trades).toHaveLength(1);
  });
});

describe('GET /api/orderbook/orders/:id', () => {
  it('returns order by id', async () => {
    await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'alice', side: 'buy', price: 100, quantity: 5 });
    const res = await request(app).get('/api/orderbook/orders/1');
    expect(res.status).toBe(200);
    expect(res.body.data.owner).toBe('alice');
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/orderbook/orders/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/orderbook/orders/:id/cancel', () => {
  it('cancels an order', async () => {
    await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'alice', side: 'buy', price: 100, quantity: 5 });
    const res = await request(app)
      .post('/api/orderbook/orders/1/cancel')
      .send({ owner: 'alice' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('returns 403 for wrong owner', async () => {
    await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'alice', side: 'buy', price: 100, quantity: 5 });
    const res = await request(app)
      .post('/api/orderbook/orders/1/cancel')
      .send({ owner: 'bob' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/orderbook/trades', () => {
  it('returns trade history', async () => {
    await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'seller', side: 'sell', price: 100, quantity: 5 });
    await request(app)
      .post('/api/orderbook/orders')
      .send({ owner: 'buyer', side: 'buy', price: 100, quantity: 5 });
    const res = await request(app).get('/api/orderbook/trades');
    expect(res.status).toBe(200);
    expect(res.body.data.trades).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
  });
});

describe('GET /api/orderbook/stats', () => {
  it('returns stats', async () => {
    const res = await request(app).get('/api/orderbook/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totalOrders');
    expect(res.body.data).toHaveProperty('totalTrades');
  });
});
