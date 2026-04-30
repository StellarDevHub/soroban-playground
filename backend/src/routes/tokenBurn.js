// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

// ── In-memory supply tracker (replace with DB in production) ─────────────────
// Keyed by contractId.
const supplyStore = new Map();

function getState(contractId) {
  if (!supplyStore.has(contractId)) {
    supplyStore.set(contractId, {
      contractId,
      totalSupply: 0,
      totalBurned: 0,
      burnRate: 0,
      history: [],
    });
  }
  return supplyStore.get(contractId);
}

// ── Validation helpers ────────────────────────────────────────────────────────

function validateContractId(id) {
  return typeof id === 'string' && /^C[A-Z0-9]{55}$/.test(id);
}

function validatePositiveInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

// ── POST /api/token-burn/burn ─────────────────────────────────────────────────
// Body: { contractId, from, amount }
// Records a burn event and updates tracked supply.
router.post(
  '/burn',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, from, amount } = req.body || {};

    if (!validateContractId(contractId)) {
      return next(createHttpError(400, 'contractId must be a valid Stellar contract ID'));
    }
    if (typeof from !== 'string' || !from.trim()) {
      return next(createHttpError(400, 'from address is required'));
    }
    if (!validatePositiveInt(amount)) {
      return next(createHttpError(400, 'amount must be a positive integer'));
    }

    const state = getState(contractId);

    if (amount > state.totalSupply) {
      return next(createHttpError(422, 'Burn amount exceeds tracked supply'));
    }

    state.totalSupply -= amount;
    state.totalBurned += amount;

    const event = {
      type: 'burn',
      from,
      amount,
      totalSupply: state.totalSupply,
      totalBurned: state.totalBurned,
      timestamp: new Date().toISOString(),
    };
    state.history.unshift(event);
    if (state.history.length > 100) state.history.pop();

    return res.status(200).json({
      success: true,
      data: {
        contractId,
        from,
        amount,
        totalSupply: state.totalSupply,
        totalBurned: state.totalBurned,
        burnedAt: event.timestamp,
      },
    });
  })
);

// ── POST /api/token-burn/init ─────────────────────────────────────────────────
// Body: { contractId, initialSupply, burnRate }
// Seeds the tracker for a newly deployed contract.
router.post(
  '/init',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, initialSupply, burnRate } = req.body || {};

    if (!validateContractId(contractId)) {
      return next(createHttpError(400, 'contractId must be a valid Stellar contract ID'));
    }
    if (!validatePositiveInt(initialSupply)) {
      return next(createHttpError(400, 'initialSupply must be a positive integer'));
    }
    if (typeof burnRate !== 'number' || burnRate < 0 || burnRate > 10000) {
      return next(createHttpError(400, 'burnRate must be 0–10000 (basis points)'));
    }

    const state = getState(contractId);
    state.totalSupply = initialSupply;
    state.totalBurned = 0;
    state.burnRate = burnRate;
    state.history = [
      {
        type: 'init',
        initialSupply,
        burnRate,
        timestamp: new Date().toISOString(),
      },
    ];

    return res.status(201).json({ success: true, data: state });
  })
);

// ── GET /api/token-burn/supply/:contractId ────────────────────────────────────
// Returns current supply stats for a contract.
router.get(
  '/supply/:contractId',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.params;

    if (!validateContractId(contractId)) {
      return next(createHttpError(400, 'contractId must be a valid Stellar contract ID'));
    }

    const state = getState(contractId);
    const burnedPercent =
      state.totalSupply + state.totalBurned > 0
        ? ((state.totalBurned / (state.totalSupply + state.totalBurned)) * 100).toFixed(4)
        : '0.0000';

    return res.status(200).json({
      success: true,
      data: {
        contractId,
        totalSupply: state.totalSupply,
        totalBurned: state.totalBurned,
        burnRate: state.burnRate,
        burnedPercent,
        lastUpdated: state.history[0]?.timestamp ?? null,
      },
    });
  })
);

// ── GET /api/token-burn/history/:contractId ───────────────────────────────────
// Returns the last ≤100 burn events for a contract.
router.get(
  '/history/:contractId',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    if (!validateContractId(contractId)) {
      return next(createHttpError(400, 'contractId must be a valid Stellar contract ID'));
    }

    const state = getState(contractId);

    return res.status(200).json({
      success: true,
      data: {
        contractId,
        events: state.history.slice(0, limit),
        total: state.history.length,
      },
    });
  })
);

// ── POST /api/token-burn/burn-rate ────────────────────────────────────────────
// Body: { contractId, burnRate }
// Updates the tracked burn rate.
router.post(
  '/burn-rate',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, burnRate } = req.body || {};

    if (!validateContractId(contractId)) {
      return next(createHttpError(400, 'contractId must be a valid Stellar contract ID'));
    }
    if (typeof burnRate !== 'number' || burnRate < 0 || burnRate > 10000) {
      return next(createHttpError(400, 'burnRate must be 0–10000 (basis points)'));
    }

    const state = getState(contractId);
    state.burnRate = burnRate;
    state.history.unshift({
      type: 'rate_change',
      burnRate,
      timestamp: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      data: { contractId, burnRate },
    });
  })
);

export default router;
