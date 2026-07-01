// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Prediction Market API
 *
 * REST endpoints for the Soroban Prediction Market contract.
 * Allows buying YES/NO shares on binary/scalar markets and resolving via Oracle.
 *
 * Routes:
 *   POST   /api/prediction-market/initialize
 *   POST   /api/prediction-market/markets
 *   GET    /api/prediction-market/markets?contractId=
 *   GET    /api/prediction-market/markets/:id?contractId=
 *   POST   /api/prediction-market/markets/:id/bet
 *   POST   /api/prediction-market/markets/:id/resolve
 *   POST   /api/prediction-market/markets/:id/cancel
 *   GET    /api/prediction-market/markets/:id/payout/:trader?contractId=
 *   GET    /api/prediction-market/markets/:id/position/:trader?contractId=
 *   GET    /api/prediction-market/count?contractId=
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { invokeSorobanContract } from '../services/invokeService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

// ── Validation helpers ────────────────────────────────────────────────────────

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;
const ADDRESS_RE = /^G[A-Z0-9]{55}$/;

function validateContractId(id) {
  return typeof id === 'string' && CONTRACT_ID_RE.test(id);
}

function validateAddress(addr) {
  return typeof addr === 'string' && ADDRESS_RE.test(addr);
}

function requireFields(body, fields) {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ''
  );
  return missing.length ? missing.map((f) => `${f} is required`) : null;
}

function getContractId(req) {
  const id = req.body?.contractId || req.query?.contractId;
  if (!validateContractId(id)) {
    throw createHttpError(400, 'Valid contractId (C + 55 chars) is required');
  }
  return id;
}

async function invoke(contractId, functionName, args, network) {
  return invokeSorobanContract({
    requestId: `pm-${functionName}-${Date.now()}`,
    contractId,
    functionName,
    args: args || {},
    network: network || 'testnet',
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/prediction-market/initialize
 * Initialize the contract with an admin address.
 * Body: { contractId, admin, network? }
 */
router.post(
  '/initialize',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', { errors: errs }));

    const { contractId, admin, network } = req.body;

    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId format'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address format'));

    const result = await invoke(contractId, 'initialize', { admin }, network);
    res.status(200).json({ success: true, data: result });
  })
);

/**
 * POST /api/prediction-market/markets
 * Create a new prediction market.
 * Body: { contractId, creator, question, marketType (0=Binary, 1=Scalar),
 *         resolutionDeadline (unix timestamp), oracle, network? }
 */
router.post(
  '/markets',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, [
      'contractId',
      'creator',
      'question',
      'resolutionDeadline',
      'oracle',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', { errors: errs }));

    const {
      contractId,
      creator,
      question,
      marketType = 0,
      resolutionDeadline,
      oracle,
      network,
    } = req.body;

    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId format'));
    if (!validateAddress(creator))
      return next(createHttpError(400, 'Invalid creator address format'));
    if (!validateAddress(oracle))
      return next(createHttpError(400, 'Invalid oracle address format'));
    if (![0, 1].includes(Number(marketType)))
      return next(createHttpError(400, 'marketType must be 0 (Binary) or 1 (Scalar)'));
    if (typeof question !== 'string' || question.trim().length === 0)
      return next(createHttpError(400, 'question must be a non-empty string'));

    const deadlineTs = Number(resolutionDeadline);
    if (!Number.isInteger(deadlineTs) || deadlineTs <= 0)
      return next(createHttpError(400, 'resolutionDeadline must be a positive integer (Unix timestamp)'));

    const result = await invoke(
      contractId,
      'create_market',
      {
        creator,
        question: question.trim(),
        market_type: Number(marketType),
        resolution_deadline: deadlineTs,
        oracle,
      },
      network
    );

    res.status(201).json({ success: true, data: result });
  })
);

/**
 * GET /api/prediction-market/markets?contractId=
 * List all markets (fetches count then individual markets).
 */
router.get(
  '/markets',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;

    // Get total count first
    const countResult = await invoke(contractId, 'market_count', {}, network);
    const count = typeof countResult === 'number' ? countResult : 0;

    if (count === 0) {
      return res.json({ success: true, data: { markets: [], count: 0 } });
    }

    // Fetch markets in parallel (IDs are 1-indexed)
    const fetches = Array.from({ length: count }, (_, i) =>
      invoke(contractId, 'get_market', { market_id: i + 1 }, network).catch((err) => ({
        error: err.message,
        id: i + 1,
      }))
    );

    const markets = await Promise.all(fetches);
    res.json({ success: true, data: { markets, count } });
  })
);

/**
 * GET /api/prediction-market/markets/:id?contractId=
 * Get a single market by ID.
 */
router.get(
  '/markets/:id',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const marketId = parseInt(req.params.id, 10);
    const { network } = req.query;

    if (!Number.isInteger(marketId) || marketId <= 0)
      return next(createHttpError(400, 'Market ID must be a positive integer'));

    const result = await invoke(contractId, 'get_market', { market_id: marketId }, network);
    res.json({ success: true, data: result });
  })
);

/**
 * POST /api/prediction-market/markets/:id/bet
 * Place a YES or NO bet on a market.
 * Body: { contractId, trader, outcome (0=NO, 1=YES), stake, network? }
 */
router.post(
  '/markets/:id/bet',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['contractId', 'trader', 'stake']);
    if (errs) return next(createHttpError(400, 'Validation failed', { errors: errs }));

    const { contractId, trader, stake, network } = req.body;
    const outcome = req.body.outcome !== undefined ? Number(req.body.outcome) : undefined;
    const marketId = parseInt(req.params.id, 10);

    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId format'));
    if (!validateAddress(trader))
      return next(createHttpError(400, 'Invalid trader address format'));
    if (!Number.isInteger(marketId) || marketId <= 0)
      return next(createHttpError(400, 'Market ID must be a positive integer'));
    if (outcome === undefined || (outcome !== 0 && outcome !== 1))
      return next(createHttpError(400, 'outcome must be 0 (NO) or 1 (YES)'));

    const stakeNum = Number(stake);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0)
      return next(createHttpError(400, 'stake must be a positive number'));

    const result = await invoke(
      contractId,
      'place_bet',
      {
        trader,
        market_id: marketId,
        outcome,
        stake: stakeNum,
      },
      network
    );

    res.status(200).json({ success: true, data: result });
  })
);

/**
 * POST /api/prediction-market/markets/:id/resolve
 * Resolve a market via the oracle.
 * Body: { contractId, winningOutcome (0=NO, 1=YES), network? }
 * The oracle address must be the caller — auth is enforced on-chain.
 */
router.post(
  '/markets/:id/resolve',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['contractId']);
    if (errs) return next(createHttpError(400, 'Validation failed', { errors: errs }));

    const { contractId, network } = req.body;
    const winningOutcome = req.body.winningOutcome !== undefined
      ? Number(req.body.winningOutcome)
      : undefined;
    const marketId = parseInt(req.params.id, 10);

    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId format'));
    if (!Number.isInteger(marketId) || marketId <= 0)
      return next(createHttpError(400, 'Market ID must be a positive integer'));
    if (winningOutcome === undefined || (winningOutcome !== 0 && winningOutcome !== 1))
      return next(createHttpError(400, 'winningOutcome must be 0 (NO) or 1 (YES)'));

    const result = await invoke(
      contractId,
      'resolve_market',
      {
        market_id: marketId,
        winning_outcome: winningOutcome,
      },
      network
    );

    res.status(200).json({ success: true, data: result });
  })
);

/**
 * POST /api/prediction-market/markets/:id/cancel
 * Cancel a market (admin or creator only).
 * Body: { contractId, network? }
 */
router.post(
  '/markets/:id/cancel',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['contractId']);
    if (errs) return next(createHttpError(400, 'Validation failed', { errors: errs }));

    const { contractId, network } = req.body;
    const marketId = parseInt(req.params.id, 10);

    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId format'));
    if (!Number.isInteger(marketId) || marketId <= 0)
      return next(createHttpError(400, 'Market ID must be a positive integer'));

    const result = await invoke(
      contractId,
      'cancel_market',
      { market_id: marketId },
      network
    );

    res.status(200).json({ success: true, data: result });
  })
);

/**
 * GET /api/prediction-market/markets/:id/payout/:trader?contractId=
 * Calculate the payout for a trader on a resolved/cancelled market.
 */
router.get(
  '/markets/:id/payout/:trader',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const marketId = parseInt(req.params.id, 10);
    const { trader } = req.params;
    const { network } = req.query;

    if (!Number.isInteger(marketId) || marketId <= 0)
      return next(createHttpError(400, 'Market ID must be a positive integer'));
    if (!validateAddress(trader))
      return next(createHttpError(400, 'Invalid trader address format'));

    const result = await invoke(
      contractId,
      'calculate_payout',
      { market_id: marketId, trader },
      network
    );

    res.json({ success: true, data: { payout: result } });
  })
);

/**
 * GET /api/prediction-market/markets/:id/position/:trader?contractId=
 * Get a trader's position on a specific market.
 */
router.get(
  '/markets/:id/position/:trader',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const marketId = parseInt(req.params.id, 10);
    const { trader } = req.params;
    const { network } = req.query;

    if (!Number.isInteger(marketId) || marketId <= 0)
      return next(createHttpError(400, 'Market ID must be a positive integer'));
    if (!validateAddress(trader))
      return next(createHttpError(400, 'Invalid trader address format'));

    const result = await invoke(
      contractId,
      'get_position',
      { market_id: marketId, trader },
      network
    );

    res.json({ success: true, data: result });
  })
);

/**
 * GET /api/prediction-market/count?contractId=
 * Get the total number of markets created.
 */
router.get(
  '/count',
  rateLimitMiddleware('read'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;

    const result = await invoke(contractId, 'market_count', {}, network);
    res.json({ success: true, data: { count: result } });
  })
);

export default router;
