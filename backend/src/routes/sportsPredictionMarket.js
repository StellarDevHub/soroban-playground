/**
 * Sports Prediction Market API
 *
 * Endpoints for managing sports prediction markets on the Soroban blockchain.
 * All write operations proxy to the Soroban CLI via invokeService.
 *
 * Routes:
 *   POST   /sports-markets/initialize
 *   POST   /sports-markets
 *   GET    /sports-markets
 *   GET    /sports-markets/:id
 *   POST   /sports-markets/:id/bet
 *   POST   /sports-markets/:id/resolve
 *   POST   /sports-markets/:id/cancel
 *   POST   /sports-markets/:id/update-odds
 *   GET    /sports-markets/:id/payout/:bettor
 *   GET    /sports-markets/:id/analytics
 *   POST   /sports-markets/pause
 *   POST   /sports-markets/unpause
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
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
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
    requestId: `sports-${functionName}-${Date.now()}`,
    contractId,
    functionName,
    args: args || {},
    network: network || 'testnet',
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /sports-markets/initialize
 * Initialize the contract with an admin address.
 */
router.post(
  '/initialize',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));

    const result = await invoke(contractId, 'initialize', { admin }, network);
    return res.json({ success: true, message: 'Contract initialized', output: result.parsed });
  })
);

/**
 * POST /sports-markets
 * Create a new sports prediction market.
 */
router.post(
  '/',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const {
      contractId,
      creator,
      description,
      sport,
      homeTeam,
      awayTeam,
      resolutionDeadline,
      oracle,
      oddsHomeBp,
      oddsDrawBp,
      oddsAwayBp,
      network,
    } = req.body || {};

    const errs = requireFields(req.body, [
      'contractId', 'creator', 'description', 'sport',
      'homeTeam', 'awayTeam', 'resolutionDeadline', 'oracle',
      'oddsHomeBp', 'oddsDrawBp', 'oddsAwayBp',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(creator))
      return next(createHttpError(400, 'Invalid creator address'));
    if (!validateAddress(oracle))
      return next(createHttpError(400, 'Invalid oracle address'));
    if (typeof sport !== 'number' || sport < 0 || sport > 5)
      return next(createHttpError(400, 'sport must be 0-5'));
    if (typeof resolutionDeadline !== 'number' || resolutionDeadline <= Date.now() / 1000)
      return next(createHttpError(400, 'resolutionDeadline must be a future unix timestamp'));
    for (const [name, val] of [['oddsHomeBp', oddsHomeBp], ['oddsDrawBp', oddsDrawBp], ['oddsAwayBp', oddsAwayBp]]) {
      if (typeof val !== 'number' || val < 10100)
        return next(createHttpError(400, `${name} must be >= 10100 (1.01x)`));
    }

    const result = await invoke(contractId, 'create_market', {
      creator,
      description,
      sport,
      home_team: homeTeam,
      away_team: awayTeam,
      resolution_deadline: resolutionDeadline,
      oracle,
      odds_home_bp: oddsHomeBp,
      odds_draw_bp: oddsDrawBp,
      odds_away_bp: oddsAwayBp,
    }, network);

    return res.status(201).json({
      success: true,
      message: 'Sports market created',
      marketId: result.parsed,
      output: result.parsed,
    });
  })
);

/**
 * GET /sports-markets/:id
 * Get a single market by ID.
 */
router.get(
  '/:id',
  asyncHandler(async (req, res, next) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId) || marketId < 1)
      return next(createHttpError(400, 'Invalid market id'));
    const contractId = getContractId(req);

    const result = await invoke(contractId, 'get_market', { market_id: marketId }, req.query.network);
    return res.json({ success: true, market: result.parsed });
  })
);

/**
 * GET /sports-markets
 * Get market count (clients can iterate from 1..count).
 */
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const result = await invoke(contractId, 'market_count', {}, req.query.network);
    return res.json({ success: true, marketCount: result.parsed });
  })
);

/**
 * POST /sports-markets/:id/bet
 * Place a bet on a market outcome.
 * outcome: 0=Home, 1=Draw, 2=Away
 */
router.post(
  '/:id/bet',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId) || marketId < 1)
      return next(createHttpError(400, 'Invalid market id'));

    const { contractId, bettor, outcome, stake, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'bettor', 'outcome', 'stake']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(bettor))
      return next(createHttpError(400, 'Invalid bettor address'));
    if (![0, 1, 2].includes(outcome))
      return next(createHttpError(400, 'outcome must be 0 (Home), 1 (Draw), or 2 (Away)'));
    if (typeof stake !== 'number' || stake <= 0)
      return next(createHttpError(400, 'stake must be a positive number'));

    const result = await invoke(contractId, 'place_bet', {
      bettor,
      market_id: marketId,
      outcome,
      stake,
    }, network);

    return res.json({ success: true, message: 'Bet placed', output: result.parsed });
  })
);

/**
 * POST /sports-markets/:id/resolve
 * Resolve a market (oracle only).
 * winningOutcome: 0=Home, 1=Draw, 2=Away
 */
router.post(
  '/:id/resolve',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId) || marketId < 1)
      return next(createHttpError(400, 'Invalid market id'));

    const { contractId, winningOutcome, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'winningOutcome']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (![0, 1, 2].includes(winningOutcome))
      return next(createHttpError(400, 'winningOutcome must be 0, 1, or 2'));

    const result = await invoke(contractId, 'resolve_market', {
      market_id: marketId,
      winning_outcome: winningOutcome,
    }, network);

    return res.json({ success: true, message: 'Market resolved', output: result.parsed });
  })
);

/**
 * POST /sports-markets/:id/cancel
 * Cancel a market (admin only).
 */
router.post(
  '/:id/cancel',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId) || marketId < 1)
      return next(createHttpError(400, 'Invalid market id'));

    const { contractId, network } = req.body || {};
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));

    const result = await invoke(contractId, 'cancel_market', { market_id: marketId }, network);
    return res.json({ success: true, message: 'Market cancelled', output: result.parsed });
  })
);

/**
 * POST /sports-markets/:id/update-odds
 * Update odds for an open market (oracle only).
 */
router.post(
  '/:id/update-odds',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId) || marketId < 1)
      return next(createHttpError(400, 'Invalid market id'));

    const { contractId, oddsHomeBp, oddsDrawBp, oddsAwayBp, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'oddsHomeBp', 'oddsDrawBp', 'oddsAwayBp']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    for (const [name, val] of [['oddsHomeBp', oddsHomeBp], ['oddsDrawBp', oddsDrawBp], ['oddsAwayBp', oddsAwayBp]]) {
      if (typeof val !== 'number' || val < 10100)
        return next(createHttpError(400, `${name} must be >= 10100`));
    }

    const result = await invoke(contractId, 'update_odds', {
      market_id: marketId,
      odds_home_bp: oddsHomeBp,
      odds_draw_bp: oddsDrawBp,
      odds_away_bp: oddsAwayBp,
    }, network);

    return res.json({ success: true, message: 'Odds updated', output: result.parsed });
  })
);

/**
 * GET /sports-markets/:id/payout/:bettor
 * Calculate payout for a bettor on a resolved/cancelled market.
 */
router.get(
  '/:id/payout/:bettor',
  asyncHandler(async (req, res, next) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId) || marketId < 1)
      return next(createHttpError(400, 'Invalid market id'));
    if (!validateAddress(req.params.bettor))
      return next(createHttpError(400, 'Invalid bettor address'));

    const contractId = getContractId(req);
    const result = await invoke(contractId, 'calculate_payout', {
      market_id: marketId,
      bettor: req.params.bettor,
    }, req.query.network);

    return res.json({ success: true, payout: result.parsed });
  })
);

/**
 * GET /sports-markets/:id/analytics
 * Get pool analytics: total pool and percentage per outcome.
 */
router.get(
  '/:id/analytics',
  asyncHandler(async (req, res, next) => {
    const marketId = parseInt(req.params.id, 10);
    if (isNaN(marketId) || marketId < 1)
      return next(createHttpError(400, 'Invalid market id'));

    const contractId = getContractId(req);
    const result = await invoke(contractId, 'get_pool_analytics', { market_id: marketId }, req.query.network);

    // result.parsed is (total, home_pct_bp, draw_pct_bp, away_pct_bp)
    const [totalPool, homePctBp, drawPctBp, awayPctBp] = Array.isArray(result.parsed)
      ? result.parsed
      : [0, 0, 0, 0];

    return res.json({
      success: true,
      analytics: {
        totalPool,
        home: { pctBp: homePctBp, pct: (homePctBp / 100).toFixed(2) },
        draw: { pctBp: drawPctBp, pct: (drawPctBp / 100).toFixed(2) },
        away: { pctBp: awayPctBp, pct: (awayPctBp / 100).toFixed(2) },
      },
    });
  })
);

/**
 * POST /sports-markets/pause
 * Pause the contract (admin only).
 */
router.post(
  '/pause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, network } = req.body || {};
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    const result = await invoke(contractId, 'pause', {}, network);
    return res.json({ success: true, message: 'Contract paused', output: result.parsed });
  })
);

/**
 * POST /sports-markets/unpause
 * Unpause the contract (admin only).
 */
router.post(
  '/unpause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, network } = req.body || {};
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    const result = await invoke(contractId, 'unpause', {}, network);
    return res.json({ success: true, message: 'Contract unpaused', output: result.parsed });
  })
);

export default router;
