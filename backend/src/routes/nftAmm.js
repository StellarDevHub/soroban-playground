// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * NFT AMM REST API
 *
 * RESTful endpoints for the NFT Automated Market Maker system.
 * Mirrors the on-chain contract logic for the playground demo.
 *
 * Routes
 * ──────
 * GET    /api/nft-amm/health
 * GET    /api/nft-amm/stats
 * GET    /api/nft-amm/pools                  – List pools (filterable)
 * POST   /api/nft-amm/pools                  – Create pool
 * GET    /api/nft-amm/pools/:id              – Get pool
 * PATCH  /api/nft-amm/pools/:id/params       – Update spot price / delta
 * PATCH  /api/nft-amm/pools/:id/deactivate   – Deactivate pool
 * POST   /api/nft-amm/pools/:id/deposit/tokens
 * POST   /api/nft-amm/pools/:id/deposit/nfts
 * POST   /api/nft-amm/pools/:id/withdraw/tokens
 * POST   /api/nft-amm/pools/:id/withdraw/nfts
 * POST   /api/nft-amm/pools/:id/buy          – Buy NFT from pool
 * POST   /api/nft-amm/pools/:id/sell         – Sell NFT to pool
 * GET    /api/nft-amm/pools/:id/price/buy    – Preview buy price
 * GET    /api/nft-amm/pools/:id/price/sell   – Preview sell price
 * GET    /api/nft-amm/collections/:address/analytics – Collection analytics
 * POST   /api/nft-amm/admin/pause            – Pause / unpause
 * GET    /api/nft-amm/admin/fees             – Protocol fee info
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const CURVE_TYPES = ['Linear', 'Exponential'];
const POOL_TYPES = ['Buy', 'Sell', 'Trade'];
const BPS_DENOM = 10_000;
const DEFAULT_PROTOCOL_FEE_BPS = 50; // 0.5%
const MAX_FEE_BPS = 5_000;
const MAX_PROTOCOL_FEE_BPS = 1_000;

// ── In-memory store ───────────────────────────────────────────────────────────

const store = {
  pools: new Map(),
  nextId: 1,
  paused: false,
  protocolFeeBps: DEFAULT_PROTOCOL_FEE_BPS,
  protocolFeeBalance: 0,
  trades: [],          // trade history for analytics
};

// ── Validation helpers ────────────────────────────────────────────────────────

function validateAddress(addr) {
  return typeof addr === 'string' && /^[GC][A-Z0-9]{55}$/.test(addr);
}

function validateCurve(curve) {
  return CURVE_TYPES.includes(curve);
}

function validatePoolType(type) {
  return POOL_TYPES.includes(type);
}

function positiveInt(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Pricing helpers ───────────────────────────────────────────────────────────

function calcBuyPrice(pool) {
  const fee = Math.floor((pool.spotPrice * pool.feeBps) / BPS_DENOM);
  const protocolFee = Math.floor((pool.spotPrice * store.protocolFeeBps) / BPS_DENOM);
  return pool.spotPrice + fee + protocolFee;
}

function calcSellPrice(pool) {
  const fee = Math.floor((pool.spotPrice * pool.feeBps) / BPS_DENOM);
  const protocolFee = Math.floor((pool.spotPrice * store.protocolFeeBps) / BPS_DENOM);
  return pool.spotPrice - fee - protocolFee;
}

function nextPriceUp(pool) {
  if (pool.curve === 'Linear') return pool.spotPrice + pool.delta;
  // Exponential: spot * (1 + delta/10000)
  return pool.spotPrice + Math.floor((pool.spotPrice * pool.delta) / BPS_DENOM);
}

function nextPriceDown(pool) {
  let newPrice;
  if (pool.curve === 'Linear') {
    newPrice = pool.spotPrice - pool.delta;
  } else {
    newPrice = pool.spotPrice - Math.floor((pool.spotPrice * pool.delta) / BPS_DENOM);
  }
  return Math.max(1, newPrice);
}

// ── GET /health ───────────────────────────────────────────────────────────────

router.get('/health', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    status: 'ok',
    service: 'nft-amm',
    paused: store.paused,
    poolCount: store.pools.size,
    timestamp: new Date().toISOString(),
  });
}));

// ── GET /stats ────────────────────────────────────────────────────────────────

router.get('/stats', asyncHandler(async (_req, res) => {
  const pools = [...store.pools.values()];
  const totalVolume = pools.reduce((s, p) => s + p.totalVolume, 0);
  const totalTrades = pools.reduce((s, p) => s + p.tradeCount, 0);
  const byType = {};
  const byCurve = {};
  for (const p of pools) {
    byType[p.poolType] = (byType[p.poolType] || 0) + 1;
    byCurve[p.curve] = (byCurve[p.curve] || 0) + 1;
  }

  res.json({
    success: true,
    data: {
      totalPools: pools.length,
      activePools: pools.filter((p) => p.active).length,
      totalVolume,
      totalTrades,
      byType,
      byCurve,
      protocolFeeBps: store.protocolFeeBps,
      protocolFeeBalance: store.protocolFeeBalance,
      paused: store.paused,
    },
  });
}));

// ── GET /pools ────────────────────────────────────────────────────────────────

router.get('/pools', asyncHandler(async (req, res) => {
  const { poolType, curve, collection, active, page = '1', limit = '20' } = req.query;

  let pools = [...store.pools.values()];

  if (poolType && validatePoolType(poolType)) pools = pools.filter((p) => p.poolType === poolType);
  if (curve && validateCurve(curve)) pools = pools.filter((p) => p.curve === curve);
  if (collection) pools = pools.filter((p) => p.nftCollection === collection);
  if (active !== undefined) pools = pools.filter((p) => p.active === (active === 'true'));

  pools.sort((a, b) => b.createdAt - a.createdAt);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const total = pools.length;
  const paginated = pools.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json({
    success: true,
    data: paginated,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
}));

// ── POST /pools ───────────────────────────────────────────────────────────────

router.post('/pools', asyncHandler(async (req, res, next) => {
  if (store.paused) return next(createHttpError(503, 'NFT AMM is paused'));

  const { owner, nftCollection, paymentToken, curve, poolType, spotPrice, delta, feeBps = 0 } = req.body || {};

  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  if (!validateAddress(nftCollection)) return next(createHttpError(400, 'Invalid nftCollection address'));
  if (!validateAddress(paymentToken)) return next(createHttpError(400, 'Invalid paymentToken address'));
  if (!validateCurve(curve)) return next(createHttpError(400, `curve must be one of: ${CURVE_TYPES.join(', ')}`));
  if (!validatePoolType(poolType)) return next(createHttpError(400, `poolType must be one of: ${POOL_TYPES.join(', ')}`));

  const spot = parseInt(spotPrice, 10);
  if (!Number.isInteger(spot) || spot <= 0) return next(createHttpError(400, 'spotPrice must be a positive integer'));

  const d = parseInt(delta, 10);
  if (!Number.isInteger(d) || d < 0) return next(createHttpError(400, 'delta must be a non-negative integer'));

  const fee = parseInt(feeBps, 10);
  if (!Number.isInteger(fee) || fee < 0 || fee > MAX_FEE_BPS) return next(createHttpError(400, `feeBps must be 0–${MAX_FEE_BPS}`));
  if (poolType !== 'Trade' && fee > 0) return next(createHttpError(400, 'Only Trade pools can have a fee'));

  const id = store.nextId++;
  const pool = {
    id, owner, nftCollection, paymentToken, curve, poolType,
    spotPrice: spot, delta: d, feeBps: fee,
    nftCount: 0, nftIds: [],
    tokenBalance: 0,
    totalVolume: 0, tradeCount: 0,
    active: true,
    createdAt: Date.now(),
  };

  store.pools.set(id, pool);

  res.status(201).json({ success: true, message: 'Pool created', data: pool });
}));

// ── GET /pools/:id ────────────────────────────────────────────────────────────

router.get('/pools/:id', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  res.json({ success: true, data: pool });
}));

// ── PATCH /pools/:id/params ───────────────────────────────────────────────────

router.patch('/pools/:id/params', asyncHandler(async (req, res, next) => {
  if (store.paused) return next(createHttpError(503, 'NFT AMM is paused'));
  const id = parseInt(req.params.id, 10);
  const { owner, spotPrice, delta } = req.body || {};

  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (pool.owner !== owner) return next(createHttpError(403, 'Not the pool owner'));
  if (!pool.active) return next(createHttpError(409, 'Pool is not active'));

  const spot = parseInt(spotPrice, 10);
  if (!Number.isInteger(spot) || spot <= 0) return next(createHttpError(400, 'spotPrice must be a positive integer'));
  const d = parseInt(delta, 10);
  if (!Number.isInteger(d) || d < 0) return next(createHttpError(400, 'delta must be a non-negative integer'));

  pool.spotPrice = spot;
  pool.delta = d;

  res.json({ success: true, message: 'Pool params updated', data: pool });
}));

// ── PATCH /pools/:id/deactivate ───────────────────────────────────────────────

router.patch('/pools/:id/deactivate', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const { owner } = req.body || {};
  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (pool.owner !== owner) return next(createHttpError(403, 'Not the pool owner'));
  pool.active = false;
  res.json({ success: true, message: 'Pool deactivated', data: pool });
}));

// ── POST /pools/:id/deposit/tokens ────────────────────────────────────────────

router.post('/pools/:id/deposit/tokens', asyncHandler(async (req, res, next) => {
  if (store.paused) return next(createHttpError(503, 'NFT AMM is paused'));
  const id = parseInt(req.params.id, 10);
  const { owner, amount } = req.body || {};
  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (pool.owner !== owner) return next(createHttpError(403, 'Not the pool owner'));
  if (!pool.active) return next(createHttpError(409, 'Pool is not active'));
  if (pool.poolType === 'Sell') return next(createHttpError(409, 'Sell pools do not hold tokens'));
  const amt = positiveInt(amount);
  if (!amt) return next(createHttpError(400, 'amount must be a positive integer'));
  pool.tokenBalance += amt;
  res.json({ success: true, message: `Deposited ${amt} tokens`, data: pool });
}));

// ── POST /pools/:id/deposit/nfts ──────────────────────────────────────────────

router.post('/pools/:id/deposit/nfts', asyncHandler(async (req, res, next) => {
  if (store.paused) return next(createHttpError(503, 'NFT AMM is paused'));
  const id = parseInt(req.params.id, 10);
  const { owner, nftIds } = req.body || {};
  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  if (!Array.isArray(nftIds) || nftIds.length === 0) return next(createHttpError(400, 'nftIds must be a non-empty array'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (pool.owner !== owner) return next(createHttpError(403, 'Not the pool owner'));
  if (!pool.active) return next(createHttpError(409, 'Pool is not active'));
  if (pool.poolType === 'Buy') return next(createHttpError(409, 'Buy pools do not hold NFTs'));
  pool.nftIds.push(...nftIds);
  pool.nftCount = pool.nftIds.length;
  res.json({ success: true, message: `Deposited ${nftIds.length} NFTs`, data: pool });
}));

// ── POST /pools/:id/withdraw/tokens ───────────────────────────────────────────

router.post('/pools/:id/withdraw/tokens', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const { owner, amount } = req.body || {};
  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (pool.owner !== owner) return next(createHttpError(403, 'Not the pool owner'));
  const amt = positiveInt(amount);
  if (!amt) return next(createHttpError(400, 'amount must be a positive integer'));
  if (amt > pool.tokenBalance) return next(createHttpError(409, 'Insufficient token balance'));
  pool.tokenBalance -= amt;
  res.json({ success: true, message: `Withdrew ${amt} tokens`, data: pool });
}));

// ── POST /pools/:id/withdraw/nfts ─────────────────────────────────────────────

router.post('/pools/:id/withdraw/nfts', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const { owner, count } = req.body || {};
  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (pool.owner !== owner) return next(createHttpError(403, 'Not the pool owner'));
  const n = positiveInt(count);
  if (!n) return next(createHttpError(400, 'count must be a positive integer'));
  if (n > pool.nftCount) return next(createHttpError(409, 'Insufficient NFTs in pool'));
  const withdrawn = pool.nftIds.splice(pool.nftIds.length - n, n);
  pool.nftCount = pool.nftIds.length;
  res.json({ success: true, message: `Withdrew ${n} NFTs`, data: { pool, withdrawnNftIds: withdrawn } });
}));

// ── POST /pools/:id/buy ───────────────────────────────────────────────────────

router.post('/pools/:id/buy', asyncHandler(async (req, res, next) => {
  if (store.paused) return next(createHttpError(503, 'NFT AMM is paused'));
  const id = parseInt(req.params.id, 10);
  const { buyer, maxPrice } = req.body || {};

  if (!validateAddress(buyer)) return next(createHttpError(400, 'Invalid buyer address'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (!pool.active) return next(createHttpError(409, 'Pool is not active'));
  if (pool.poolType === 'Buy') return next(createHttpError(409, 'Buy pools do not sell NFTs'));
  if (pool.nftCount === 0) return next(createHttpError(409, 'No NFTs in pool'));

  const totalPrice = calcBuyPrice(pool);
  const max = parseInt(maxPrice, 10);
  if (!Number.isInteger(max) || totalPrice > max) {
    return next(createHttpError(409, `Price ${totalPrice} exceeds maxPrice ${max}`));
  }

  const protocolFee = Math.floor((pool.spotPrice * store.protocolFeeBps) / BPS_DENOM);
  const poolFee = Math.floor((pool.spotPrice * pool.feeBps) / BPS_DENOM);

  const nftId = pool.nftIds.pop();
  pool.nftCount = pool.nftIds.length;
  pool.tokenBalance += pool.spotPrice + poolFee;
  pool.totalVolume += totalPrice;
  pool.tradeCount += 1;
  store.protocolFeeBalance += protocolFee;
  pool.spotPrice = nextPriceUp(pool);

  store.trades.push({ type: 'buy', poolId: id, nftId, price: totalPrice, buyer, ts: Date.now() });

  res.json({
    success: true,
    message: `Bought NFT #${nftId} for ${totalPrice} stroops`,
    data: { nftId, price: totalPrice, newSpotPrice: pool.spotPrice, pool },
  });
}));

// ── POST /pools/:id/sell ──────────────────────────────────────────────────────

router.post('/pools/:id/sell', asyncHandler(async (req, res, next) => {
  if (store.paused) return next(createHttpError(503, 'NFT AMM is paused'));
  const id = parseInt(req.params.id, 10);
  const { seller, nftId, minPrice } = req.body || {};

  if (!validateAddress(seller)) return next(createHttpError(400, 'Invalid seller address'));
  if (nftId === undefined || nftId === null) return next(createHttpError(400, 'nftId is required'));
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  if (!pool.active) return next(createHttpError(409, 'Pool is not active'));
  if (pool.poolType === 'Sell') return next(createHttpError(409, 'Sell pools do not buy NFTs'));

  const payout = calcSellPrice(pool);
  const min = parseInt(minPrice, 10);
  if (!Number.isInteger(min) || payout < min) {
    return next(createHttpError(409, `Payout ${payout} is below minPrice ${min}`));
  }

  const protocolFee = Math.floor((pool.spotPrice * store.protocolFeeBps) / BPS_DENOM);
  const poolFee = Math.floor((pool.spotPrice * pool.feeBps) / BPS_DENOM);
  const totalCost = payout + protocolFee;

  if (pool.tokenBalance < totalCost) {
    return next(createHttpError(409, `Insufficient pool token balance (${pool.tokenBalance} < ${totalCost})`));
  }

  pool.nftIds.push(nftId);
  pool.nftCount = pool.nftIds.length;
  pool.tokenBalance -= totalCost;
  pool.totalVolume += pool.spotPrice;
  pool.tradeCount += 1;
  store.protocolFeeBalance += protocolFee;
  pool.spotPrice = nextPriceDown(pool);

  store.trades.push({ type: 'sell', poolId: id, nftId, price: payout, seller, ts: Date.now() });

  res.json({
    success: true,
    message: `Sold NFT #${nftId} for ${payout} stroops`,
    data: { nftId, payout, newSpotPrice: pool.spotPrice, pool },
  });
}));

// ── GET /pools/:id/price/buy ──────────────────────────────────────────────────

router.get('/pools/:id/price/buy', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  res.json({ success: true, data: { buyPrice: calcBuyPrice(pool), spotPrice: pool.spotPrice } });
}));

// ── GET /pools/:id/price/sell ─────────────────────────────────────────────────

router.get('/pools/:id/price/sell', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const pool = store.pools.get(id);
  if (!pool) return next(createHttpError(404, `Pool #${id} not found`));
  res.json({ success: true, data: { sellPrice: calcSellPrice(pool), spotPrice: pool.spotPrice } });
}));

// ── GET /collections/:address/analytics ──────────────────────────────────────

router.get('/collections/:address/analytics', asyncHandler(async (req, res) => {
  const { address } = req.params;
  const collectionPools = [...store.pools.values()].filter((p) => p.nftCollection === address);
  const collectionTrades = store.trades.filter((t) =>
    collectionPools.some((p) => p.id === t.poolId)
  );

  const totalVolume = collectionPools.reduce((s, p) => s + p.totalVolume, 0);
  const totalNfts = collectionPools.reduce((s, p) => s + p.nftCount, 0);
  const floorPool = collectionPools
    .filter((p) => p.active && p.poolType !== 'Buy' && p.nftCount > 0)
    .sort((a, b) => calcBuyPrice(a) - calcBuyPrice(b))[0];

  const prices = collectionTrades.map((t) => t.price);
  const avgPrice = prices.length > 0 ? Math.round(prices.reduce((s, p) => s + p, 0) / prices.length) : 0;

  res.json({
    success: true,
    data: {
      collection: address,
      totalPools: collectionPools.length,
      activePools: collectionPools.filter((p) => p.active).length,
      totalNftsInPools: totalNfts,
      totalVolume,
      totalTrades: collectionTrades.length,
      floorPrice: floorPool ? calcBuyPrice(floorPool) : null,
      averageTradePrice: avgPrice,
      recentTrades: collectionTrades.slice(-10).reverse(),
    },
  });
}));

// ── POST /admin/pause ─────────────────────────────────────────────────────────

router.post('/admin/pause', asyncHandler(async (req, res, next) => {
  const { adminAddress, paused } = req.body || {};
  if (!validateAddress(adminAddress)) return next(createHttpError(400, 'Invalid adminAddress'));
  if (typeof paused !== 'boolean') return next(createHttpError(400, 'paused must be a boolean'));
  store.paused = paused;
  res.json({ success: true, message: paused ? 'AMM paused' : 'AMM unpaused', data: { paused } });
}));

// ── GET /admin/fees ───────────────────────────────────────────────────────────

router.get('/admin/fees', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      protocolFeeBps: store.protocolFeeBps,
      protocolFeeBalance: store.protocolFeeBalance,
      protocolFeeBalanceXlm: (store.protocolFeeBalance / 10_000_000).toFixed(7),
    },
  });
}));

export default router;
