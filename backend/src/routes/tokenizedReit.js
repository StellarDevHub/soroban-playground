/**
 * Tokenized REIT API
 *
 * Endpoints for managing Tokenized Real Estate Investment Trusts on Soroban.
 * All write operations proxy to the Soroban CLI via invokeService.
 *
 * Routes:
 *   POST   /reit/initialize
 *   POST   /reit/trusts
 *   GET    /reit/trusts
 *   GET    /reit/trusts/:id
 *   POST   /reit/trusts/:id/deactivate
 *   POST   /reit/trusts/:id/dividends
 *   POST   /reit/trusts/:id/buy
 *   POST   /reit/trusts/:id/transfer
 *   POST   /reit/trusts/:id/claim
 *   GET    /reit/trusts/:id/holding/:investor
 *   GET    /reit/trusts/:id/claimable/:investor
 *   POST   /reit/pause
 *   POST   /reit/unpause
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
    requestId: `reit-${functionName}-${Date.now()}`,
    contractId,
    functionName,
    args: args || {},
    network: network || 'testnet',
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /reit/initialize
 * Initialize the REIT contract with an admin address.
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
    return res.json({ success: true, message: 'REIT contract initialized', output: result.parsed });
  })
);

/**
 * POST /reit/trusts
 * Create a new REIT trust.
 * Body: { contractId, admin, name, totalShares, pricePerShare, annualYieldBps, network? }
 */
router.post(
  '/trusts',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, name, totalShares, pricePerShare, annualYieldBps, network } =
      req.body || {};

    const errs = requireFields(req.body, [
      'contractId', 'admin', 'name', 'totalShares', 'pricePerShare', 'annualYieldBps',
    ]);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    if (typeof totalShares !== 'number' || totalShares <= 0)
      return next(createHttpError(400, 'totalShares must be a positive number'));
    if (typeof pricePerShare !== 'number' || pricePerShare <= 0)
      return next(createHttpError(400, 'pricePerShare must be a positive number'));
    if (typeof annualYieldBps !== 'number' || annualYieldBps < 0 || annualYieldBps > 10000)
      return next(createHttpError(400, 'annualYieldBps must be 0–10000'));

    const result = await invoke(
      contractId,
      'create_trust',
      {
        admin,
        name,
        total_shares: totalShares,
        price_per_share: pricePerShare,
        annual_yield_bps: annualYieldBps,
      },
      network
    );

    return res.status(201).json({
      success: true,
      message: 'REIT trust created',
      trustId: result.parsed,
      output: result.parsed,
    });
  })
);

/**
 * GET /reit/trusts
 * Get total trust count (clients iterate 1..count).
 */
router.get(
  '/trusts',
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const result = await invoke(contractId, 'trust_count', {}, req.query.network);
    return res.json({ success: true, trustCount: result.parsed });
  })
);

/**
 * GET /reit/trusts/:id
 * Get a single REIT trust by ID.
 */
router.get(
  '/trusts/:id',
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));
    const contractId = getContractId(req);

    const result = await invoke(contractId, 'get_trust', { trust_id: trustId }, req.query.network);
    return res.json({ success: true, trust: result.parsed });
  })
);

/**
 * POST /reit/trusts/:id/deactivate
 * Deactivate a trust (admin only).
 */
router.post(
  '/trusts/:id/deactivate',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));

    const { contractId, admin, network } = req.body || {};
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));

    const result = await invoke(
      contractId,
      'deactivate_trust',
      { admin, trust_id: trustId },
      network
    );
    return res.json({ success: true, message: 'Trust deactivated', output: result.parsed });
  })
);

/**
 * POST /reit/trusts/:id/dividends
 * Deposit dividend income for a trust (admin only).
 * Body: { contractId, admin, amount, network? }
 */
router.post(
  '/trusts/:id/dividends',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));

    const { contractId, admin, amount, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin', 'amount']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    if (typeof amount !== 'number' || amount <= 0)
      return next(createHttpError(400, 'amount must be a positive number'));

    const result = await invoke(
      contractId,
      'deposit_dividends',
      { admin, trust_id: trustId, amount },
      network
    );
    return res.json({ success: true, message: 'Dividends deposited', output: result.parsed });
  })
);

/**
 * POST /reit/trusts/:id/buy
 * Buy shares in a REIT trust.
 * Body: { contractId, investor, shares, network? }
 */
router.post(
  '/trusts/:id/buy',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));

    const { contractId, investor, shares, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'investor', 'shares']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(investor))
      return next(createHttpError(400, 'Invalid investor address'));
    if (typeof shares !== 'number' || shares <= 0 || !Number.isInteger(shares))
      return next(createHttpError(400, 'shares must be a positive integer'));

    const result = await invoke(
      contractId,
      'buy_shares',
      { investor, trust_id: trustId, shares },
      network
    );
    return res.json({ success: true, message: 'Shares purchased', cost: result.parsed, output: result.parsed });
  })
);

/**
 * POST /reit/trusts/:id/transfer
 * Transfer shares between investors.
 * Body: { contractId, from, to, shares, network? }
 */
router.post(
  '/trusts/:id/transfer',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));

    const { contractId, from, to, shares, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'from', 'to', 'shares']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(from))
      return next(createHttpError(400, 'Invalid from address'));
    if (!validateAddress(to))
      return next(createHttpError(400, 'Invalid to address'));
    if (from === to)
      return next(createHttpError(400, 'from and to must be different addresses'));
    if (typeof shares !== 'number' || shares <= 0 || !Number.isInteger(shares))
      return next(createHttpError(400, 'shares must be a positive integer'));

    const result = await invoke(
      contractId,
      'transfer_shares',
      { from, to, trust_id: trustId, shares },
      network
    );
    return res.json({ success: true, message: 'Shares transferred', output: result.parsed });
  })
);

/**
 * POST /reit/trusts/:id/claim
 * Claim dividend income for an investor.
 * Body: { contractId, investor, network? }
 */
router.post(
  '/trusts/:id/claim',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));

    const { contractId, investor, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'investor']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(investor))
      return next(createHttpError(400, 'Invalid investor address'));

    const result = await invoke(
      contractId,
      'claim_dividends',
      { investor, trust_id: trustId },
      network
    );
    return res.json({ success: true, message: 'Dividends claimed', amount: result.parsed, output: result.parsed });
  })
);

/**
 * GET /reit/trusts/:id/holding/:investor
 * Get an investor's holding in a trust.
 */
router.get(
  '/trusts/:id/holding/:investor',
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));
    if (!validateAddress(req.params.investor))
      return next(createHttpError(400, 'Invalid investor address'));

    const contractId = getContractId(req);
    const result = await invoke(
      contractId,
      'get_holding',
      { investor: req.params.investor, trust_id: trustId },
      req.query.network
    );
    return res.json({ success: true, holding: result.parsed });
  })
);

/**
 * GET /reit/trusts/:id/claimable/:investor
 * Get claimable dividend amount for an investor (read-only).
 */
router.get(
  '/trusts/:id/claimable/:investor',
  asyncHandler(async (req, res, next) => {
    const trustId = parseInt(req.params.id, 10);
    if (isNaN(trustId) || trustId < 1)
      return next(createHttpError(400, 'Invalid trust id'));
    if (!validateAddress(req.params.investor))
      return next(createHttpError(400, 'Invalid investor address'));

    const contractId = getContractId(req);
    const result = await invoke(
      contractId,
      'claimable_dividends',
      { investor: req.params.investor, trust_id: trustId },
      req.query.network
    );
    return res.json({ success: true, claimable: result.parsed });
  })
);

/**
 * POST /reit/pause
 * Pause the contract (admin only).
 */
router.post(
  '/pause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    const result = await invoke(contractId, 'pause', { admin }, network);
    return res.json({ success: true, message: 'Contract paused', output: result.parsed });
  })
);

/**
 * POST /reit/unpause
 * Unpause the contract (admin only).
 */
router.post(
  '/unpause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    if (!validateContractId(contractId))
      return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin))
      return next(createHttpError(400, 'Invalid admin address'));
    const result = await invoke(contractId, 'unpause', { admin }, network);
    return res.json({ success: true, message: 'Contract unpaused', output: result.parsed });
  })
);

export default router;
