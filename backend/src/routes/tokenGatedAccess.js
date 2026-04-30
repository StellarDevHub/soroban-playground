// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

// ── In-memory store (replace with DB in production) ───────────────────────────

const memberships = new Map(); // tokenId -> membership
const ownerIndex = new Map(); // address -> tokenId
let nextTokenId = 1;
const analytics = {
  totalMembers: 0,
  basicCount: 0,
  premiumCount: 0,
  eliteCount: 0,
  totalAccessChecks: 0,
  lastUpdated: new Date().toISOString(),
};

const VALID_TIERS = ['Basic', 'Premium', 'Elite'];
const TIER_RANK = { Basic: 0, Premium: 1, Elite: 2 };

function updateAnalytics(delta) {
  Object.assign(analytics, delta, { lastUpdated: new Date().toISOString() });
}

// ── Input validation helpers ──────────────────────────────────────────────────

function validateAddress(addr) {
  return typeof addr === 'string' && addr.length > 0;
}

function validateTier(tier) {
  return VALID_TIERS.includes(tier);
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/token-gated/mint
 * Mint a membership NFT.
 * Body: { admin, recipient, tier, expiresAt?, metadataUri }
 */
router.post(
  '/mint',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { admin, recipient, tier, expiresAt = 0, metadataUri = '' } = req.body || {};

    if (!validateAddress(admin)) return next(createHttpError(400, 'admin address required'));
    if (!validateAddress(recipient)) return next(createHttpError(400, 'recipient address required'));
    if (!validateTier(tier)) return next(createHttpError(400, `tier must be one of: ${VALID_TIERS.join(', ')}`));
    if (ownerIndex.has(recipient)) return next(createHttpError(409, 'Address already has a membership'));

    const tokenId = nextTokenId++;
    const membership = {
      tokenId,
      owner: recipient,
      tier,
      issuedAt: new Date().toISOString(),
      expiresAt: expiresAt || null,
      metadataUri,
    };

    memberships.set(tokenId, membership);
    ownerIndex.set(recipient, tokenId);

    analytics.totalMembers += 1;
    analytics[`${tier.toLowerCase()}Count`] += 1;
    updateAnalytics({});

    return res.status(201).json({ success: true, data: membership });
  })
);

/**
 * DELETE /api/token-gated/revoke/:tokenId
 * Revoke a membership NFT.
 */
router.delete(
  '/revoke/:tokenId',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const tokenId = parseInt(req.params.tokenId, 10);
    if (!memberships.has(tokenId)) return next(createHttpError(404, 'Membership not found'));

    const m = memberships.get(tokenId);
    memberships.delete(tokenId);
    ownerIndex.delete(m.owner);

    if (analytics.totalMembers > 0) analytics.totalMembers -= 1;
    const key = `${m.tier.toLowerCase()}Count`;
    if (analytics[key] > 0) analytics[key] -= 1;
    updateAnalytics({});

    return res.json({ success: true, message: `Token ${tokenId} revoked` });
  })
);

/**
 * PATCH /api/token-gated/upgrade/:tokenId
 * Upgrade a membership tier.
 * Body: { newTier }
 */
router.patch(
  '/upgrade/:tokenId',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const tokenId = parseInt(req.params.tokenId, 10);
    const { newTier } = req.body || {};

    if (!memberships.has(tokenId)) return next(createHttpError(404, 'Membership not found'));
    if (!validateTier(newTier)) return next(createHttpError(400, `newTier must be one of: ${VALID_TIERS.join(', ')}`));

    const m = memberships.get(tokenId);
    const oldTier = m.tier;
    m.tier = newTier;
    memberships.set(tokenId, m);

    const oldKey = `${oldTier.toLowerCase()}Count`;
    const newKey = `${newTier.toLowerCase()}Count`;
    if (analytics[oldKey] > 0) analytics[oldKey] -= 1;
    analytics[newKey] += 1;
    updateAnalytics({});

    return res.json({ success: true, data: m });
  })
);

/**
 * GET /api/token-gated/check-access
 * Check if an address has access at a minimum tier.
 * Query: address, minTier
 */
router.get(
  '/check-access',
  asyncHandler(async (req, res, next) => {
    const { address, minTier = 'Basic' } = req.query;

    if (!validateAddress(address)) return next(createHttpError(400, 'address query param required'));
    if (!validateTier(minTier)) return next(createHttpError(400, `minTier must be one of: ${VALID_TIERS.join(', ')}`));

    analytics.totalAccessChecks += 1;
    updateAnalytics({});

    const tokenId = ownerIndex.get(address);
    if (tokenId === undefined) {
      return res.json({ success: true, data: { granted: false, reason: 'no_membership' } });
    }

    const m = memberships.get(tokenId);
    if (m.expiresAt && new Date(m.expiresAt) < new Date()) {
      return res.json({ success: true, data: { granted: false, reason: 'expired' } });
    }

    const granted = TIER_RANK[m.tier] >= TIER_RANK[minTier];
    return res.json({
      success: true,
      data: { granted, tier: m.tier, tokenId, reason: granted ? 'ok' : 'insufficient_tier' },
    });
  })
);

/**
 * GET /api/token-gated/membership/:address
 * Get membership details for an address.
 */
router.get(
  '/membership/:address',
  asyncHandler(async (req, res, next) => {
    const { address } = req.params;
    const tokenId = ownerIndex.get(address);
    if (tokenId === undefined) return next(createHttpError(404, 'No membership found for address'));
    return res.json({ success: true, data: memberships.get(tokenId) });
  })
);

/**
 * GET /api/token-gated/analytics
 * Get community analytics.
 */
router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    return res.json({ success: true, data: analytics });
  })
);

/**
 * GET /api/token-gated/members
 * List all memberships (paginated).
 * Query: page (default 1), limit (default 20)
 */
router.get(
  '/members',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const all = Array.from(memberships.values());
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    return res.json({
      success: true,
      data: { items, total: all.length, page, limit },
    });
  })
);

export default router;
