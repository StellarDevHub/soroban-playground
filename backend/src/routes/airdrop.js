// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  addToAllowlist,
  removeFromAllowlist,
  checkEligibility,
  recordClaim,
  endCampaign,
  getCampaignStats,
} from '../services/airdropService.js';

const router = express.Router();

// ── Validation helpers ────────────────────────────────────────────────────────

function validateAddress(addr) {
  return typeof addr === 'string' && addr.length >= 10;
}

function validateCampaignBody(body) {
  const errors = [];
  const { admin, token, amountPerClaim, totalAmount, startTimestamp, endTimestamp } = body;

  if (!validateAddress(admin)) errors.push('admin must be a valid address');
  if (!validateAddress(token)) errors.push('token must be a valid address');
  if (!amountPerClaim || Number(amountPerClaim) <= 0) errors.push('amountPerClaim must be > 0');
  if (!totalAmount || Number(totalAmount) <= 0) errors.push('totalAmount must be > 0');
  if (!startTimestamp || !endTimestamp) errors.push('startTimestamp and endTimestamp are required');
  if (Number(endTimestamp) <= Number(startTimestamp)) errors.push('endTimestamp must be after startTimestamp');

  return errors;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/airdrop/campaigns
 * List all campaigns with optional status filter and pagination.
 */
router.get(
  '/campaigns',
  asyncHandler(async (req, res) => {
    const { status, page = 1, limit = 20 } = req.query;
    const result = await listCampaigns({
      status,
      page: Math.max(1, parseInt(page, 10)),
      limit: Math.min(100, Math.max(1, parseInt(limit, 10))),
    });
    res.json({ success: true, data: result });
  })
);

/**
 * POST /api/airdrop/campaigns
 * Create a new airdrop campaign.
 */
router.post(
  '/campaigns',
  asyncHandler(async (req, res, next) => {
    const errors = validateCampaignBody(req.body);
    if (errors.length > 0) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

    const {
      admin, token, amountPerClaim, totalAmount,
      startTimestamp, endTimestamp, requireAllowlist,
      name, description,
    } = req.body;

    const campaign = await createCampaign({
      admin, token,
      amountPerClaim: Number(amountPerClaim),
      totalAmount: Number(totalAmount),
      startTimestamp: Number(startTimestamp),
      endTimestamp: Number(endTimestamp),
      requireAllowlist: Boolean(requireAllowlist),
      name, description,
    });

    res.status(201).json({ success: true, data: campaign });
  })
);

/**
 * GET /api/airdrop/campaigns/:id
 * Get a single campaign by ID.
 */
router.get(
  '/campaigns/:id',
  asyncHandler(async (req, res, next) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return next(createHttpError(404, 'Campaign not found'));
    res.json({ success: true, data: campaign });
  })
);

/**
 * GET /api/airdrop/campaigns/:id/stats
 * Get campaign statistics.
 */
router.get(
  '/campaigns/:id/stats',
  asyncHandler(async (req, res, next) => {
    const stats = await getCampaignStats(req.params.id);
    if (!stats) return next(createHttpError(404, 'Campaign not found'));
    res.json({ success: true, data: stats });
  })
);

/**
 * POST /api/airdrop/campaigns/:id/end
 * End a campaign early and return unclaimed tokens.
 */
router.post(
  '/campaigns/:id/end',
  asyncHandler(async (req, res, next) => {
    const { admin } = req.body;
    if (!validateAddress(admin)) {
      return next(createHttpError(400, 'admin address is required'));
    }

    const result = await endCampaign(req.params.id, admin);
    if (!result) return next(createHttpError(404, 'Campaign not found'));
    if (result.error === 'unauthorized') return next(createHttpError(403, 'Unauthorized'));

    res.json({ success: true, data: result });
  })
);

/**
 * POST /api/airdrop/campaigns/:id/allowlist
 * Add addresses to the campaign allowlist.
 */
router.post(
  '/campaigns/:id/allowlist',
  asyncHandler(async (req, res, next) => {
    const { addresses } = req.body;
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return next(createHttpError(400, 'addresses must be a non-empty array'));
    }
    if (addresses.length > 200) {
      return next(createHttpError(400, 'Maximum 200 addresses per request'));
    }
    if (!addresses.every(validateAddress)) {
      return next(createHttpError(400, 'All addresses must be valid'));
    }

    const result = await addToAllowlist(req.params.id, addresses);
    if (!result) return next(createHttpError(404, 'Campaign not found'));
    res.json({ success: true, data: result });
  })
);

/**
 * DELETE /api/airdrop/campaigns/:id/allowlist/:address
 * Remove an address from the campaign allowlist.
 */
router.delete(
  '/campaigns/:id/allowlist/:address',
  asyncHandler(async (req, res, next) => {
    const result = await removeFromAllowlist(req.params.id, req.params.address);
    if (!result) return next(createHttpError(404, 'Campaign not found'));
    res.json({ success: true, data: result });
  })
);

/**
 * GET /api/airdrop/campaigns/:id/eligibility/:address
 * Check if an address is eligible to claim.
 */
router.get(
  '/campaigns/:id/eligibility/:address',
  asyncHandler(async (req, res, next) => {
    const result = await checkEligibility(req.params.id, req.params.address);
    if (!result) return next(createHttpError(404, 'Campaign not found'));
    res.json({ success: true, data: result });
  })
);

/**
 * POST /api/airdrop/campaigns/:id/claim
 * Record a claim (called after on-chain transaction is confirmed).
 */
router.post(
  '/campaigns/:id/claim',
  asyncHandler(async (req, res, next) => {
    const { address } = req.body;
    if (!validateAddress(address)) {
      return next(createHttpError(400, 'address is required'));
    }

    const result = await recordClaim(req.params.id, address);
    if (!result) return next(createHttpError(404, 'Campaign not found'));
    if (result.error === 'already_claimed') {
      return next(createHttpError(409, 'Address has already claimed'));
    }

    res.json({ success: true, data: result });
  })
);

export default router;
