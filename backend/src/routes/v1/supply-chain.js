import express from 'express';
import { asyncHandler, createHttpError } from '../../middleware/errorHandler.js';
import { invokeSorobanContract } from '../../services/invokeService.js';
import cacheService from '../../services/cacheService.js';

const router = express.Router();

// ── Validation ────────────────────────────────────────────────────────────────

function validateContractId(contractId) {
  if (!contractId || typeof contractId !== 'string') {
    return 'contractId is required';
  }
  if (!/^C[A-Z0-9]{55}$/.test(contractId)) {
    return 'contractId must be a valid Stellar contract ID';
  }
  return null;
}

function validateAddress(addr, fieldName = 'address') {
  if (!addr || typeof addr !== 'string') {
    return `${fieldName} is required`;
  }
  if (!/^G[A-Z0-9]{55}$/.test(addr)) {
    return `${fieldName} must be a valid Stellar address`;
  }
  return null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/supply-chain/:contractId/products
 * List all products (returns product count, client fetches individually)
 */
router.get(
  '/:contractId/products',
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.params;
    const err = validateContractId(contractId);
    if (err) return next(createHttpError(400, err));

    const cacheKey = `supply-chain:${contractId}:count`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return res.json({ success: true, count: parseInt(cached, 10) });
    }

    const result = await invokeSorobanContract({
      requestId: `sc-count-${Date.now()}`,
      contractId,
      functionName: 'product_count',
      args: {},
      network: req.query.network || 'testnet',
    });

    const count = result.parsed || 0;
    await cacheService.set(cacheKey, String(count), 60);
    return res.json({ success: true, count });
  })
);

/**
 * GET /api/v1/supply-chain/:contractId/products/:productId
 * Get product details
 */
router.get(
  '/:contractId/products/:productId',
  asyncHandler(async (req, res, next) => {
    const { contractId, productId } = req.params;
    const err = validateContractId(contractId);
    if (err) return next(createHttpError(400, err));

    const id = parseInt(productId, 10);
    if (!Number.isInteger(id) || id < 1) {
      return next(createHttpError(400, 'productId must be a positive integer'));
    }

    const result = await invokeSorobanContract({
      requestId: `sc-product-${Date.now()}`,
      contractId,
      functionName: 'get_product',
      args: { product_id: id },
      network: req.query.network || 'testnet',
    });

    return res.json({ success: true, product: result.parsed });
  })
);

/**
 * POST /api/v1/supply-chain/:contractId/products
 * Register a new product
 * Body: { owner, name, metadataHash, sourceAccount }
 */
router.post(
  '/:contractId/products',
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.params;
    const { owner, name, metadataHash, sourceAccount } = req.body;

    const err = validateContractId(contractId) || validateAddress(owner, 'owner');
    if (err) return next(createHttpError(400, err));
    if (!name || typeof name !== 'string') {
      return next(createHttpError(400, 'name is required'));
    }
    if (metadataHash === undefined || typeof metadataHash !== 'number') {
      return next(createHttpError(400, 'metadataHash must be a number'));
    }

    const result = await invokeSorobanContract({
      requestId: `sc-register-${Date.now()}`,
      contractId,
      functionName: 'register_product',
      args: { owner, name, metadata_hash: metadataHash },
      network: req.query.network || 'testnet',
      sourceAccount,
    });

    return res.json({
      success: true,
      productId: result.parsed,
      message: 'Product registered successfully',
    });
  })
);

/**
 * POST /api/v1/supply-chain/:contractId/products/:productId/checkpoints
 * Add a checkpoint
 * Body: { handler, locationHash, notesHash, sourceAccount }
 */
router.post(
  '/:contractId/products/:productId/checkpoints',
  asyncHandler(async (req, res, next) => {
    const { contractId, productId } = req.params;
    const { handler, locationHash, notesHash, sourceAccount } = req.body;

    const err = validateContractId(contractId) || validateAddress(handler, 'handler');
    if (err) return next(createHttpError(400, err));

    const id = parseInt(productId, 10);
    if (!Number.isInteger(id) || id < 1) {
      return next(createHttpError(400, 'productId must be a positive integer'));
    }

    const result = await invokeSorobanContract({
      requestId: `sc-checkpoint-${Date.now()}`,
      contractId,
      functionName: 'add_checkpoint',
      args: {
        handler,
        product_id: id,
        location_hash: locationHash || 0,
        notes_hash: notesHash || 0,
      },
      network: req.query.network || 'testnet',
      sourceAccount,
    });

    return res.json({
      success: true,
      checkpointIndex: result.parsed,
      message: 'Checkpoint added successfully',
    });
  })
);

/**
 * POST /api/v1/supply-chain/:contractId/products/:productId/quality-report
 * Submit quality report
 * Body: { inspector, result, reportHash, sourceAccount }
 */
router.post(
  '/:contractId/products/:productId/quality-report',
  asyncHandler(async (req, res, next) => {
    const { contractId, productId } = req.params;
    const { inspector, result, reportHash, sourceAccount } = req.body;

    const err = validateContractId(contractId) || validateAddress(inspector, 'inspector');
    if (err) return next(createHttpError(400, err));

    const id = parseInt(productId, 10);
    if (!Number.isInteger(id) || id < 1) {
      return next(createHttpError(400, 'productId must be a positive integer'));
    }

    if (!['Pass', 'Fail', 'Pending'].includes(result)) {
      return next(createHttpError(400, 'result must be Pass, Fail, or Pending'));
    }

    await invokeSorobanContract({
      requestId: `sc-qa-${Date.now()}`,
      contractId,
      functionName: 'submit_quality_report',
      args: {
        inspector,
        product_id: id,
        result,
        report_hash: reportHash || 0,
      },
      network: req.query.network || 'testnet',
      sourceAccount,
    });

    return res.json({
      success: true,
      message: 'Quality report submitted successfully',
    });
  })
);

/**
 * POST /api/v1/supply-chain/:contractId/products/:productId/recall
 * Recall a product
 * Body: { caller, sourceAccount }
 */
router.post(
  '/:contractId/products/:productId/recall',
  asyncHandler(async (req, res, next) => {
    const { contractId, productId } = req.params;
    const { caller, sourceAccount } = req.body;

    const err = validateContractId(contractId) || validateAddress(caller, 'caller');
    if (err) return next(createHttpError(400, err));

    const id = parseInt(productId, 10);
    if (!Number.isInteger(id) || id < 1) {
      return next(createHttpError(400, 'productId must be a positive integer'));
    }

    await invokeSorobanContract({
      requestId: `sc-recall-${Date.now()}`,
      contractId,
      functionName: 'recall_product',
      args: { caller, product_id: id },
      network: req.query.network || 'testnet',
      sourceAccount,
    });

    return res.json({
      success: true,
      message: 'Product recalled successfully',
    });
  })
);

/**
 * POST /api/v1/supply-chain/:contractId/pause
 * Pause the contract
 * Body: { caller, sourceAccount }
 */
router.post(
  '/:contractId/pause',
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.params;
    const { caller, sourceAccount } = req.body;

    const err = validateContractId(contractId) || validateAddress(caller, 'caller');
    if (err) return next(createHttpError(400, err));

    await invokeSorobanContract({
      requestId: `sc-pause-${Date.now()}`,
      contractId,
      functionName: 'pause',
      args: { caller },
      network: req.query.network || 'testnet',
      sourceAccount,
    });

    return res.json({ success: true, message: 'Contract paused' });
  })
);

/**
 * POST /api/v1/supply-chain/:contractId/unpause
 * Unpause the contract
 * Body: { caller, sourceAccount }
 */
router.post(
  '/:contractId/unpause',
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.params;
    const { caller, sourceAccount } = req.body;

    const err = validateContractId(contractId) || validateAddress(caller, 'caller');
    if (err) return next(createHttpError(400, err));

    await invokeSorobanContract({
      requestId: `sc-unpause-${Date.now()}`,
      contractId,
      functionName: 'unpause',
      args: { caller },
      network: req.query.network || 'testnet',
      sourceAccount,
    });

    return res.json({ success: true, message: 'Contract unpaused' });
  })
);

/**
 * GET /api/v1/supply-chain/:contractId/paused
 * Check if contract is paused
 */
router.get(
  '/:contractId/paused',
  asyncHandler(async (req, res, next) => {
    const { contractId } = req.params;
    const err = validateContractId(contractId);
    if (err) return next(createHttpError(400, err));

    const result = await invokeSorobanContract({
      requestId: `sc-paused-${Date.now()}`,
      contractId,
      functionName: 'paused',
      args: {},
      network: req.query.network || 'testnet',
    });

    return res.json({ success: true, paused: result.parsed });
  })
);

export default router;
