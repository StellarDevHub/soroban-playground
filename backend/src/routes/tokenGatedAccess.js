// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT
//
// Token-Gated Access Control API
// Endpoints for membership NFT management and community analytics.

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { invokeSorobanContract } from '../services/invokeService.js';

const router = express.Router();

// ── Validation helpers ────────────────────────────────────────────────────────

const VALID_TIERS = ['Bronze', 'Silver', 'Gold'];
const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;
const ADDRESS_RE = /^G[A-Z0-9]{55}$/;

function validateAddress(value, field) {
  if (!value || !ADDRESS_RE.test(value)) {
    return `${field} must be a valid Stellar address`;
  }
  return null;
}

function validateContractId(value) {
  if (!value || !CONTRACT_ID_RE.test(value)) {
    return 'contract_id must be a valid Stellar contract ID';
  }
  return null;
}

function validateTier(value) {
  if (!VALID_TIERS.includes(value)) {
    return `tier must be one of: ${VALID_TIERS.join(', ')}`;
  }
  return null;
}

// ── Shared invoke helper ──────────────────────────────────────────────────────

async function invoke(contractId, functionName, args, network) {
  return invokeSorobanContract({
    requestId: `tga-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    contractId,
    functionName,
    args,
    network: network || 'testnet',
  });
}

// ── POST /token-gated/mint ────────────────────────────────────────────────────
// Mint a membership NFT for a recipient (admin only).
router.post(
  '/mint',
  asyncHandler(async (req, res, next) => {
    const { contract_id, admin, recipient, tier, metadata_uri, network } = req.body || {};

    const errors = [
      validateContractId(contract_id),
      validateAddress(admin, 'admin'),
      validateAddress(recipient, 'recipient'),
      validateTier(tier),
      !metadata_uri ? 'metadata_uri is required' : null,
    ].filter(Boolean);

    if (errors.length) return next(createHttpError(400, 'Validation failed', errors));

    try {
      const result = await invoke(contract_id, 'mint', { admin, recipient, tier, metadata_uri }, network);
      return res.status(201).json({
        success: true,
        token_id: result.parsed,
        message: `Membership NFT minted for ${recipient}`,
      });
    } catch (err) {
      return next(createHttpError(502, 'Mint failed', [err?.message]));
    }
  })
);

// ── POST /token-gated/revoke ──────────────────────────────────────────────────
// Revoke (burn) a membership NFT (admin only).
router.post(
  '/revoke',
  asyncHandler(async (req, res, next) => {
    const { contract_id, admin, recipient, network } = req.body || {};

    const errors = [
      validateContractId(contract_id),
      validateAddress(admin, 'admin'),
      validateAddress(recipient, 'recipient'),
    ].filter(Boolean);

    if (errors.length) return next(createHttpError(400, 'Validation failed', errors));

    try {
      await invoke(contract_id, 'revoke', { admin, recipient }, network);
      return res.json({ success: true, message: `Membership revoked for ${recipient}` });
    } catch (err) {
      return next(createHttpError(502, 'Revoke failed', [err?.message]));
    }
  })
);

// ── POST /token-gated/check-access ───────────────────────────────────────────
// Verify a caller has at least the required tier.
router.post(
  '/check-access',
  asyncHandler(async (req, res, next) => {
    const { contract_id, caller, required_tier, network } = req.body || {};

    const errors = [
      validateContractId(contract_id),
      validateAddress(caller, 'caller'),
      validateTier(required_tier),
    ].filter(Boolean);

    if (errors.length) return next(createHttpError(400, 'Validation failed', errors));

    try {
      const result = await invoke(contract_id, 'check_access', { caller, required_tier }, network);
      return res.json({ success: true, has_access: result.parsed === 'true' || result.parsed === true });
    } catch (err) {
      return next(createHttpError(502, 'Access check failed', [err?.message]));
    }
  })
);

// ── GET /token-gated/membership/:address ─────────────────────────────────────
// Fetch the NFT owned by an address.
router.get(
  '/membership/:address',
  asyncHandler(async (req, res, next) => {
    const { address } = req.params;
    const { contract_id, network } = req.query;

    const errors = [
      validateContractId(contract_id),
      validateAddress(address, 'address'),
    ].filter(Boolean);

    if (errors.length) return next(createHttpError(400, 'Validation failed', errors));

    try {
      const tokenResult = await invoke(contract_id, 'get_token_id', { owner: address }, network);
      if (!tokenResult.parsed || tokenResult.parsed === 'null') {
        return res.json({ success: true, membership: null });
      }
      const nftResult = await invoke(contract_id, 'get_nft', { token_id: tokenResult.parsed }, network);
      return res.json({ success: true, membership: nftResult.parsed });
    } catch (err) {
      return next(createHttpError(502, 'Membership lookup failed', [err?.message]));
    }
  })
);

// ── GET /token-gated/stats/:address ──────────────────────────────────────────
// Fetch community analytics for an address.
router.get(
  '/stats/:address',
  asyncHandler(async (req, res, next) => {
    const { address } = req.params;
    const { contract_id, network } = req.query;

    const errors = [
      validateContractId(contract_id),
      validateAddress(address, 'address'),
    ].filter(Boolean);

    if (errors.length) return next(createHttpError(400, 'Validation failed', errors));

    try {
      const result = await invoke(contract_id, 'get_stats', { member: address }, network);
      return res.json({ success: true, stats: result.parsed });
    } catch (err) {
      return next(createHttpError(502, 'Stats lookup failed', [err?.message]));
    }
  })
);

// ── GET /token-gated/community ────────────────────────────────────────────────
// Aggregate community metrics (total members, paused state).
router.get(
  '/community',
  asyncHandler(async (req, res, next) => {
    const { contract_id, network } = req.query;

    const err = validateContractId(contract_id);
    if (err) return next(createHttpError(400, 'Validation failed', [err]));

    try {
      const [totalResult, pausedResult] = await Promise.all([
        invoke(contract_id, 'total_members', {}, network),
        invoke(contract_id, 'is_paused', {}, network),
      ]);
      return res.json({
        success: true,
        community: {
          total_members: totalResult.parsed,
          is_paused: pausedResult.parsed === 'true' || pausedResult.parsed === true,
        },
      });
    } catch (err) {
      return next(createHttpError(502, 'Community stats failed', [err?.message]));
    }
  })
);

// ── POST /token-gated/pause ───────────────────────────────────────────────────
router.post(
  '/pause',
  asyncHandler(async (req, res, next) => {
    const { contract_id, admin, network } = req.body || {};
    const errors = [validateContractId(contract_id), validateAddress(admin, 'admin')].filter(Boolean);
    if (errors.length) return next(createHttpError(400, 'Validation failed', errors));

    try {
      await invoke(contract_id, 'pause', { admin }, network);
      return res.json({ success: true, message: 'Contract paused' });
    } catch (err) {
      return next(createHttpError(502, 'Pause failed', [err?.message]));
    }
  })
);

// ── POST /token-gated/unpause ─────────────────────────────────────────────────
router.post(
  '/unpause',
  asyncHandler(async (req, res, next) => {
    const { contract_id, admin, network } = req.body || {};
    const errors = [validateContractId(contract_id), validateAddress(admin, 'admin')].filter(Boolean);
    if (errors.length) return next(createHttpError(400, 'Validation failed', errors));

    try {
      await invoke(contract_id, 'unpause', { admin }, network);
      return res.json({ success: true, message: 'Contract unpaused' });
    } catch (err) {
      return next(createHttpError(502, 'Unpause failed', [err?.message]));
    }
  })
);

export default router;
