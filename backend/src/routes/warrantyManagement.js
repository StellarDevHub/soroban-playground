/**
 * Warranty Management API
 *
 * Endpoints for managing decentralized warranties on the Soroban blockchain.
 *
 * Routes:
 *   POST   /warranty/initialize
 *   POST   /warranty/pause
 *   POST   /warranty/unpause
 *   POST   /warranty/products
 *   PATCH  /warranty/products/:id/deactivate
 *   GET    /warranty/products/:id
 *   GET    /warranty/products/count
 *   POST   /warranty/warranties
 *   GET    /warranty/warranties/:id
 *   GET    /warranty/warranties/count
 *   POST   /warranty/claims
 *   PATCH  /warranty/claims/:id/resolve
 *   GET    /warranty/claims/:id
 *   GET    /warranty/claims/count
 *   GET    /warranty/status
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
    requestId: `warranty-${functionName}-${Date.now()}`,
    contractId,
    functionName,
    args: args || {},
    network: network || 'testnet',
  });
}

// ── Contract lifecycle ────────────────────────────────────────────────────────

/**
 * POST /warranty/initialize
 */
router.post(
  '/initialize',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));

    const result = await invoke(contractId, 'initialize', { admin }, network);
    return res.json({ success: true, message: 'Contract initialized', output: result.parsed });
  })
);

/**
 * POST /warranty/pause
 */
router.post(
  '/pause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));

    const result = await invoke(contractId, 'pause', { admin }, network);
    return res.json({ success: true, message: 'Contract paused', output: result.parsed });
  })
);

/**
 * POST /warranty/unpause
 */
router.post(
  '/unpause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, admin, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));

    const result = await invoke(contractId, 'unpause', { admin }, network);
    return res.json({ success: true, message: 'Contract unpaused', output: result.parsed });
  })
);

// ── Products ──────────────────────────────────────────────────────────────────

/**
 * POST /warranty/products
 * Register a new product.
 */
router.post(
  '/products',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, manufacturer, name, warrantyDurationSecs, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'manufacturer', 'name', 'warrantyDurationSecs']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(manufacturer)) return next(createHttpError(400, 'Invalid manufacturer address'));
    if (typeof warrantyDurationSecs !== 'number' || warrantyDurationSecs <= 0)
      return next(createHttpError(400, 'warrantyDurationSecs must be a positive number'));

    const result = await invoke(
      contractId,
      'register_product',
      { manufacturer, name, warranty_duration_secs: warrantyDurationSecs },
      network
    );
    return res.status(201).json({ success: true, productId: result.parsed, output: result.parsed });
  })
);

/**
 * PATCH /warranty/products/:id/deactivate
 */
router.patch(
  '/products/:id/deactivate',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, caller, network } = req.body || {};
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId < 1)
      return next(createHttpError(400, 'Invalid product id'));
    const errs = requireFields(req.body, ['contractId', 'caller']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(caller)) return next(createHttpError(400, 'Invalid caller address'));

    const result = await invoke(
      contractId,
      'deactivate_product',
      { caller, product_id: productId },
      network
    );
    return res.json({ success: true, message: 'Product deactivated', output: result.parsed });
  })
);

/**
 * GET /warranty/products/count
 */
router.get(
  '/products/count',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const result = await invoke(contractId, 'product_count', {}, network);
    return res.json({ success: true, count: result.parsed });
  })
);

/**
 * GET /warranty/products/:id
 */
router.get(
  '/products/:id',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId) || productId < 1)
      return next(createHttpError(400, 'Invalid product id'));
    const { network } = req.query;

    const result = await invoke(contractId, 'get_product', { product_id: productId }, network);
    return res.json({ success: true, product: result.parsed });
  })
);

// ── Warranties ────────────────────────────────────────────────────────────────

/**
 * POST /warranty/warranties
 * Issue a warranty to a buyer.
 */
router.post(
  '/warranties',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, issuer, productId, owner, serialNumber, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'issuer', 'productId', 'owner', 'serialNumber']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(issuer)) return next(createHttpError(400, 'Invalid issuer address'));
    if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
    if (typeof productId !== 'number' || productId < 1)
      return next(createHttpError(400, 'productId must be a positive integer'));

    const result = await invoke(
      contractId,
      'issue_warranty',
      { issuer, product_id: productId, owner, serial_number: serialNumber },
      network
    );
    return res.status(201).json({ success: true, warrantyId: result.parsed, output: result.parsed });
  })
);

/**
 * GET /warranty/warranties/count
 */
router.get(
  '/warranties/count',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const result = await invoke(contractId, 'warranty_count', {}, network);
    return res.json({ success: true, count: result.parsed });
  })
);

/**
 * GET /warranty/warranties/:id
 */
router.get(
  '/warranties/:id',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const warrantyId = Number(req.params.id);
    if (!Number.isInteger(warrantyId) || warrantyId < 1)
      return next(createHttpError(400, 'Invalid warranty id'));
    const { network } = req.query;

    const result = await invoke(contractId, 'get_warranty', { warranty_id: warrantyId }, network);
    return res.json({ success: true, warranty: result.parsed });
  })
);

// ── Claims ────────────────────────────────────────────────────────────────────

/**
 * POST /warranty/claims
 * File a warranty claim.
 */
router.post(
  '/claims',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, claimant, warrantyId, description, network } = req.body || {};
    const errs = requireFields(req.body, ['contractId', 'claimant', 'warrantyId', 'description']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(claimant)) return next(createHttpError(400, 'Invalid claimant address'));
    if (typeof warrantyId !== 'number' || warrantyId < 1)
      return next(createHttpError(400, 'warrantyId must be a positive integer'));

    const result = await invoke(
      contractId,
      'file_claim',
      { claimant, warranty_id: warrantyId, description },
      network
    );
    return res.status(201).json({ success: true, claimId: result.parsed, output: result.parsed });
  })
);

/**
 * PATCH /warranty/claims/:id/resolve
 * Approve or reject a claim.
 */
router.patch(
  '/claims/:id/resolve',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const { contractId, resolver, approve, network } = req.body || {};
    const claimId = Number(req.params.id);
    if (!Number.isInteger(claimId) || claimId < 1)
      return next(createHttpError(400, 'Invalid claim id'));
    const errs = requireFields(req.body, ['contractId', 'resolver']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));
    if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
    if (!validateAddress(resolver)) return next(createHttpError(400, 'Invalid resolver address'));
    if (typeof approve !== 'boolean')
      return next(createHttpError(400, 'approve must be a boolean'));

    const result = await invoke(
      contractId,
      'resolve_claim',
      { resolver, claim_id: claimId, approve },
      network
    );
    return res.json({
      success: true,
      message: approve ? 'Claim approved' : 'Claim rejected',
      output: result.parsed,
    });
  })
);

/**
 * GET /warranty/claims/count
 */
router.get(
  '/claims/count',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const result = await invoke(contractId, 'claim_count', {}, network);
    return res.json({ success: true, count: result.parsed });
  })
);

/**
 * GET /warranty/claims/:id
 */
router.get(
  '/claims/:id',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const claimId = Number(req.params.id);
    if (!Number.isInteger(claimId) || claimId < 1)
      return next(createHttpError(400, 'Invalid claim id'));
    const { network } = req.query;

    const result = await invoke(contractId, 'get_claim', { claim_id: claimId }, network);
    return res.json({ success: true, claim: result.parsed });
  })
);

/**
 * GET /warranty/status
 * Check if the contract is paused.
 */
router.get(
  '/status',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const contractId = getContractId(req);
    const { network } = req.query;
    const result = await invoke(contractId, 'is_paused', {}, network);
    return res.json({ success: true, paused: result.parsed });
  })
);

export default router;
