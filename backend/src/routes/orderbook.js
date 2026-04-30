// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import {
  placeOrder,
  cancelOrder,
  getOrder,
  getOrderBook,
  getTrades,
  getStats,
} from '../services/orderBookService.js';

const router = express.Router();

/**
 * @openapi
 * /api/orderbook:
 *   get:
 *     summary: Get current order book (bids and asks)
 *     tags: [OrderBook]
 *     responses:
 *       200:
 *         description: Current bids and asks
 */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getOrderBook() });
  })
);

/**
 * @openapi
 * /api/orderbook/orders:
 *   post:
 *     summary: Place a limit order
 *     tags: [OrderBook]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [owner, side, price, quantity]
 *             properties:
 *               owner:
 *                 type: string
 *               side:
 *                 type: string
 *                 enum: [buy, sell]
 *               price:
 *                 type: number
 *               quantity:
 *                 type: number
 *     responses:
 *       201:
 *         description: Order placed (and possibly matched)
 *       400:
 *         description: Validation error
 */
router.post(
  '/orders',
  asyncHandler(async (req, res, next) => {
    const { owner, side, price, quantity } = req.body || {};
    try {
      const result = placeOrder({ owner, side, price: Number(price), quantity: Number(quantity) });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(createHttpError(err.status || 400, err.message));
    }
  })
);

/**
 * @openapi
 * /api/orderbook/orders/{id}:
 *   get:
 *     summary: Get a single order by ID
 *     tags: [OrderBook]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found
 */
router.get(
  '/orders/:id',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return next(createHttpError(400, 'Invalid order ID'));
    try {
      res.json({ success: true, data: getOrder(id) });
    } catch (err) {
      next(createHttpError(err.status || 404, err.message));
    }
  })
);

/**
 * @openapi
 * /api/orderbook/orders/{id}/cancel:
 *   post:
 *     summary: Cancel an order
 *     tags: [OrderBook]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [owner]
 *             properties:
 *               owner:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order cancelled
 *       403:
 *         description: Not order owner
 *       404:
 *         description: Order not found
 *       409:
 *         description: Order already inactive
 */
router.post(
  '/orders/:id/cancel',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { owner } = req.body || {};
    if (!Number.isInteger(id)) return next(createHttpError(400, 'Invalid order ID'));
    if (!owner) return next(createHttpError(400, 'owner required'));
    try {
      const order = cancelOrder(id, owner);
      res.json({ success: true, data: order });
    } catch (err) {
      next(createHttpError(err.status || 400, err.message));
    }
  })
);

/**
 * @openapi
 * /api/orderbook/trades:
 *   get:
 *     summary: Get trade history
 *     tags: [OrderBook]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of executed trades
 */
router.get(
  '/trades',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json({ success: true, data: getTrades({ limit, offset }) });
  })
);

/**
 * @openapi
 * /api/orderbook/stats:
 *   get:
 *     summary: Get order book statistics
 *     tags: [OrderBook]
 *     responses:
 *       200:
 *         description: Aggregate stats
 */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getStats() });
  })
);

export default router;
