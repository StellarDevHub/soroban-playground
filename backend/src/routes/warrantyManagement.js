/**
 * Warranty Management API
 *
 * Routes:
 *   POST  /warranty/initialize
 *   POST  /warranty/products
 *   GET   /warranty/products/:id
 *   POST  /warranty/products/:id/deactivate
 *   POST  /warranty/warranties
 *   GET   /warranty/warranties/:id
 *   POST  /warranty/warranties/:id/void
 *   GET   /warranty/warranties/:id/valid
 *   POST  /warranty/claims
 *   GET   /warranty/claims/:id
 *   POST  /warranty/claims/:id/process
 *   POST  /warranty/pause
 *   POST  /warranty/unpause
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { invokeSorobanContract } from '../services/invokeService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

const CONTRACT_ID_RE = /^C[A-Z0-9]{55}$/;
const ADDRESS_RE = /^G[A-Z0-9]{55}$/;

function validateContractId(id) { return typeof id === 'string' && CONTRACT_ID_RE.test(id); }
function validateAddress(addr) { return typeof addr === 'string' && ADDRESS_RE.test(addr); }
function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  return missing.length ? missing.map((f) => `${f} is required`) : null;
}
function getContractId(req) {
  const id = req.body?.contractId || req.query?.contractId;
  if (!validateContractId(id)) throw createHttpError(400, 'Valid contractId (C + 55 chars) is required');
  return id;
}
async function invoke(contractId, functionName, args, network) {
  return invokeSorobanContract({
    requestId: `warranty-${functionName}-${Date.now()}`,
    contractId, functionName, args: args || {}, network: network || 'testnet',
  });
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/initialize', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'initialize', { admin }, network);
  return res.json({ success: true, message: 'Contract initialized', output: result.parsed });
}));

router.post('/products', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, name, manufacturer, defaultWarrantySecs, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'name', 'manufacturer', 'defaultWarrantySecs']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (!validateAddress(manufacturer)) return next(createHttpError(400, 'Invalid manufacturer address'));
  if (typeof defaultWarrantySecs !== 'number' || defaultWarrantySecs <= 0)
    return next(createHttpError(400, 'defaultWarrantySecs must be a positive number'));
  const result = await invoke(contractId, 'register_product',
    { admin, name, manufacturer, default_warranty_secs: defaultWarrantySecs }, network);
  return res.status(201).json({ success: true, productId: result.parsed, output: result.parsed });
}));

router.get('/products/:id', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid product id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'get_product', { product_id: id }, req.query.network);
  return res.json({ success: true, product: result.parsed });
}));

router.post('/products/:id/deactivate', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid product id'));
  const { contractId, admin, network } = req.body || {};
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'deactivate_product', { admin, product_id: id }, network);
  return res.json({ success: true, message: 'Product deactivated', output: result.parsed });
}));

router.post('/warranties', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, productId, owner, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'productId', 'owner']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (!validateAddress(owner)) return next(createHttpError(400, 'Invalid owner address'));
  if (typeof productId !== 'number' || productId < 1)
    return next(createHttpError(400, 'productId must be a positive integer'));
  const result = await invoke(contractId, 'issue_warranty',
    { admin, product_id: productId, owner }, network);
  return res.status(201).json({ success: true, warrantyId: result.parsed, output: result.parsed });
}));

router.get('/warranties/:id', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid warranty id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'get_warranty', { warranty_id: id }, req.query.network);
  return res.json({ success: true, warranty: result.parsed });
}));

router.post('/warranties/:id/void', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid warranty id'));
  const { contractId, admin, network } = req.body || {};
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'void_warranty', { admin, warranty_id: id }, network);
  return res.json({ success: true, message: 'Warranty voided', output: result.parsed });
}));

router.get('/warranties/:id/valid', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid warranty id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'is_warranty_valid', { warranty_id: id }, req.query.network);
  return res.json({ success: true, valid: result.parsed });
}));

router.post('/claims', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, claimant, warrantyId, description, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'claimant', 'warrantyId', 'description']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(claimant)) return next(createHttpError(400, 'Invalid claimant address'));
  if (typeof warrantyId !== 'number' || warrantyId < 1)
    return next(createHttpError(400, 'warrantyId must be a positive integer'));
  if (typeof description !== 'string' || description.trim().length === 0)
    return next(createHttpError(400, 'description must not be empty'));
  const result = await invoke(contractId, 'file_claim',
    { claimant, warranty_id: warrantyId, description: description.trim() }, network);
  return res.status(201).json({ success: true, claimId: result.parsed, output: result.parsed });
}));

router.get('/claims/:id', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid claim id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'get_claim', { claim_id: id }, req.query.network);
  return res.json({ success: true, claim: result.parsed });
}));

router.post('/claims/:id/process', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid claim id'));
  const { contractId, admin, approve, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (typeof approve !== 'boolean') return next(createHttpError(400, 'approve must be a boolean'));
  const result = await invoke(contractId, 'process_claim', { admin, claim_id: id, approve }, network);
  return res.json({ success: true, message: approve ? 'Claim approved' : 'Claim rejected', output: result.parsed });
}));

router.post('/pause', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, network } = req.body || {};
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'pause', { admin }, network);
  return res.json({ success: true, message: 'Contract paused', output: result.parsed });
}));

router.post('/unpause', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, network } = req.body || {};
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'unpause', { admin }, network);
  return res.json({ success: true, message: 'Contract unpaused', output: result.parsed });
}));

export default router;
