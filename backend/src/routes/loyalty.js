// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Loyalty Rewards API
 *
 * In-memory store simulates on-chain state for the playground environment.
 * All mutating endpoints validate inputs and return consistent JSON shapes.
 *
 * Routes:
 *   POST   /api/loyalty/merchants          – register merchant
 *   GET    /api/loyalty/merchants          – list merchants
 *   GET    /api/loyalty/merchants/:id      – get merchant
 *   PATCH  /api/loyalty/merchants/:id/deactivate – deactivate merchant
 *   POST   /api/loyalty/earn               – earn points
 *   POST   /api/loyalty/redeem             – redeem points (cross-merchant)
 *   GET    /api/loyalty/balance/:address   – user point balance
 *   GET    /api/loyalty/stats/:address     – user analytics
 *   GET    /api/loyalty/analytics          – program-wide analytics
 *   POST   /api/loyalty/pause              – pause contract (admin)
 *   POST   /api/loyalty/unpause            – unpause contract (admin)
 *   GET    /api/loyalty/health             – health check
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

// ── In-memory state ───────────────────────────────────────────────────────────

const state = {
  paused: false,
  admin: 'GADMIN000000000000000000000000000000000000000000000000000',
  merchants: new Map(),   // id -> Merchant
  merchantCount: 0,
  balances: new Map(),    // address -> i128
  userStats: new Map(),   // address -> { totalEarned, totalRedeemed, lastActivity }
  transactions: [],       // audit log
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMerchant(id) {
  const m = state.merchants.get(Number(id));
  if (!m) throw createHttpError(404, 'Merchant not found');
  return m;
}

function getBalance(address) {
  return state.balances.get(address) ?? 0n;
}

function getStats(address) {
  return state.userStats.get(address) ?? { totalEarned: 0n, totalRedeemed: 0n, lastActivity: null };
}

function serializeMerchant(m) {
  return { ...m, totalIssued: m.totalIssued.toString() };
}

function serializeStats(s) {
  return {
    totalEarned: s.totalEarned.toString(),
    totalRedeemed: s.totalRedeemed.toString(),
    lastActivity: s.lastActivity,
  };
}

function validateAddress(addr) {
  return typeof addr === 'string' && /^[A-Z0-9]{56}$/.test(addr);
}

function logTx(type, data) {
  state.transactions.push({ type, ...data, timestamp: new Date().toISOString() });
  // Keep last 1000 entries
  if (state.transactions.length > 1000) state.transactions.shift();
}

// ── Routes ────────────────────────────────────────────────────────────────────

// Health
router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', paused: state.paused, merchantCount: state.merchantCount } });
});

// Register merchant
router.post(
  '/merchants',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    const { caller, name } = req.body ?? {};
    if (!caller || !validateAddress(caller)) return next(createHttpError(400, 'Valid caller address required'));
    if (!name || typeof name !== 'string' || name.trim().length === 0) return next(createHttpError(400, 'Merchant name required'));
    if (caller !== state.admin) return next(createHttpError(403, 'Only admin can register merchants'));

    const id = ++state.merchantCount;
    const merchant = {
      id,
      owner: caller,
      name: name.trim(),
      active: true,
      totalIssued: 0n,
      registeredAt: new Date().toISOString(),
    };
    state.merchants.set(id, merchant);
    logTx('merchant_registered', { merchantId: id, name: merchant.name });
    res.status(201).json({ success: true, data: serializeMerchant(merchant) });
  })
);

// List merchants
router.get(
  '/merchants',
  asyncHandler(async (_req, res) => {
    const merchants = Array.from(state.merchants.values()).map(serializeMerchant);
    res.json({ success: true, data: merchants });
  })
);

// Get merchant
router.get(
  '/merchants/:id',
  asyncHandler(async (req, res, next) => {
    try {
      const merchant = getMerchant(req.params.id);
      res.json({ success: true, data: serializeMerchant(merchant) });
    } catch (e) { next(e); }
  })
);

// Deactivate merchant
router.patch(
  '/merchants/:id/deactivate',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    const { caller } = req.body ?? {};
    if (!caller || !validateAddress(caller)) return next(createHttpError(400, 'Valid caller address required'));
    if (caller !== state.admin) return next(createHttpError(403, 'Only admin can deactivate merchants'));
    try {
      const merchant = getMerchant(req.params.id);
      merchant.active = false;
      logTx('merchant_deactivated', { merchantId: merchant.id });
      res.json({ success: true, data: serializeMerchant(merchant) });
    } catch (e) { next(e); }
  })
);

// Earn points
router.post(
  '/earn',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    if (state.paused) return next(createHttpError(503, 'Contract is paused'));
    const { caller, user, merchantId, points } = req.body ?? {};
    if (!caller || !validateAddress(caller)) return next(createHttpError(400, 'Valid caller address required'));
    if (!user || !validateAddress(user)) return next(createHttpError(400, 'Valid user address required'));
    if (!merchantId) return next(createHttpError(400, 'merchantId required'));

    const pts = BigInt(points ?? 0);
    if (pts <= 0n) return next(createHttpError(400, 'points must be positive'));

    try {
      const merchant = getMerchant(merchantId);
      if (!merchant.active) return next(createHttpError(400, 'Merchant is inactive'));
      if (caller !== merchant.owner && caller !== state.admin) return next(createHttpError(403, 'Only merchant owner or admin can issue points'));

      const newBalance = getBalance(user) + pts;
      state.balances.set(user, newBalance);

      const stats = getStats(user);
      stats.totalEarned += pts;
      stats.lastActivity = new Date().toISOString();
      state.userStats.set(user, stats);

      merchant.totalIssued += pts;

      logTx('points_earned', { user, merchantId: merchant.id, points: pts.toString() });
      res.json({ success: true, data: { user, balance: newBalance.toString(), pointsEarned: pts.toString() } });
    } catch (e) { next(e); }
  })
);

// Redeem points (cross-merchant)
router.post(
  '/redeem',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    if (state.paused) return next(createHttpError(503, 'Contract is paused'));
    const { user, merchantId, points } = req.body ?? {};
    if (!user || !validateAddress(user)) return next(createHttpError(400, 'Valid user address required'));
    if (!merchantId) return next(createHttpError(400, 'merchantId required'));

    const pts = BigInt(points ?? 0);
    if (pts <= 0n) return next(createHttpError(400, 'points must be positive'));

    try {
      const merchant = getMerchant(merchantId);
      if (!merchant.active) return next(createHttpError(400, 'Merchant is inactive'));

      const balance = getBalance(user);
      if (balance < pts) return next(createHttpError(400, 'Insufficient points'));

      const newBalance = balance - pts;
      state.balances.set(user, newBalance);

      const stats = getStats(user);
      stats.totalRedeemed += pts;
      stats.lastActivity = new Date().toISOString();
      state.userStats.set(user, stats);

      logTx('points_redeemed', { user, merchantId: merchant.id, points: pts.toString() });
      res.json({ success: true, data: { user, balance: newBalance.toString(), pointsRedeemed: pts.toString() } });
    } catch (e) { next(e); }
  })
);

// User balance
router.get(
  '/balance/:address',
  asyncHandler(async (req, res, next) => {
    const { address } = req.params;
    if (!validateAddress(address)) return next(createHttpError(400, 'Invalid address'));
    res.json({ success: true, data: { address, balance: getBalance(address).toString() } });
  })
);

// User stats
router.get(
  '/stats/:address',
  asyncHandler(async (req, res, next) => {
    const { address } = req.params;
    if (!validateAddress(address)) return next(createHttpError(400, 'Invalid address'));
    res.json({ success: true, data: { address, ...serializeStats(getStats(address)) } });
  })
);

// Program-wide analytics
router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    const merchants = Array.from(state.merchants.values());
    const totalIssued = merchants.reduce((sum, m) => sum + m.totalIssued, 0n);
    const totalRedeemed = Array.from(state.userStats.values()).reduce(
      (sum, s) => sum + s.totalRedeemed, 0n
    );
    const activeUsers = state.userStats.size;
    const recentTxs = state.transactions.slice(-20).reverse();

    res.json({
      success: true,
      data: {
        totalMerchants: merchants.length,
        activeMerchants: merchants.filter(m => m.active).length,
        totalPointsIssued: totalIssued.toString(),
        totalPointsRedeemed: totalRedeemed.toString(),
        activeUsers,
        paused: state.paused,
        recentTransactions: recentTxs,
      },
    });
  })
);

// Pause
router.post(
  '/pause',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    const { caller } = req.body ?? {};
    if (!caller || !validateAddress(caller)) return next(createHttpError(400, 'Valid caller address required'));
    if (caller !== state.admin) return next(createHttpError(403, 'Only admin can pause'));
    state.paused = true;
    logTx('paused', { caller });
    res.json({ success: true, data: { paused: true } });
  })
);

// Unpause
router.post(
  '/unpause',
  rateLimitMiddleware('global'),
  asyncHandler(async (req, res, next) => {
    const { caller } = req.body ?? {};
    if (!caller || !validateAddress(caller)) return next(createHttpError(400, 'Valid caller address required'));
    if (caller !== state.admin) return next(createHttpError(403, 'Only admin can unpause'));
    state.paused = false;
    logTx('unpaused', { caller });
    res.json({ success: true, data: { paused: false } });
  })
);

export default router;
