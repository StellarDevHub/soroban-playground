/**
 * Tokenized REIT API
 *
 * Routes:
 *   POST   /reit/initialize
 *   POST   /reit/pause
 *   POST   /reit/unpause
 *   POST   /reit/properties
 *   PATCH  /reit/properties/:id/deactivate
 *   GET    /reit/properties/:id
 *   GET    /reit/properties/count
 *   POST   /reit/shares/mint
 *   POST   /reit/shares/burn
 *   POST   /reit/shares/transfer
 *   GET    /reit/shares/holding
 *   POST   /reit/dividends/deposit
 *   POST   /reit/dividends/claim
 *   GET    /reit/dividends/pending
 *   GET    /reit/status
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { invokeSorobanContract } from '../services/invokeService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

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
  if (!validateContractId(id)) throw createHttpError(400, 'Valid contractId required');
  return id;
}
async function invoke(contractId, fn, args, network) {
  return invokeSorobanContract({
    requestId: `reit-${fn}-${Date.now()}`,
    contractId,
    functionName: fn,
    args: args || {},
    network: network || 'testnet',
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

router.post('/initialize', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'initialize', { admin }, network);
  return res.json({ success: true, output: result.parsed });
}));

router.post('/pause', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'pause', { admin }, network);
  return res.json({ success: true, output: result.parsed });
}));

router.post('/unpause', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'unpause', { admin }, network);
  return res.json({ success: true, output: result.parsed });
}));

// ── Properties ────────────────────────────────────────────────────────────────

router.post('/properties', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, name, totalShares, pricePerShare, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'name', 'totalShares', 'pricePerShare']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (typeof totalShares !== 'number' || totalShares < 1)
    return next(createHttpError(400, 'totalShares must be >= 1'));
  if (typeof pricePerShare !== 'number' || pricePerShare <= 0)
    return next(createHttpError(400, 'pricePerShare must be > 0'));
  const result = await invoke(contractId, 'add_property',
    { admin, name, total_shares: totalShares, price_per_share: pricePerShare }, network);
  return res.status(201).json({ success: true, propertyId: result.parsed });
}));

router.patch('/properties/:id/deactivate', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, network } = req.body || {};
  const propertyId = Number(req.params.id);
  if (!Number.isInteger(propertyId) || propertyId < 1) return next(createHttpError(400, 'Invalid property id'));
  const errs = requireFields(req.body, ['contractId', 'admin']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'deactivate_property', { admin, property_id: propertyId }, network);
  return res.json({ success: true, output: result.parsed });
}));

router.get('/properties/count', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'property_count', {}, req.query.network);
  return res.json({ success: true, count: result.parsed });
}));

router.get('/properties/:id', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const contractId = getContractId(req);
  const propertyId = Number(req.params.id);
  if (!Number.isInteger(propertyId) || propertyId < 1) return next(createHttpError(400, 'Invalid property id'));
  const result = await invoke(contractId, 'get_property', { property_id: propertyId }, req.query.network);
  return res.json({ success: true, property: result.parsed });
}));

// ── Shares ────────────────────────────────────────────────────────────────────

router.post('/shares/mint', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, investor, propertyId, shares, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'investor', 'propertyId', 'shares']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(investor)) return next(createHttpError(400, 'Invalid investor address'));
  if (typeof propertyId !== 'number' || propertyId < 1) return next(createHttpError(400, 'propertyId must be >= 1'));
  if (typeof shares !== 'number' || shares < 1) return next(createHttpError(400, 'shares must be >= 1'));
  const result = await invoke(contractId, 'mint_shares',
    { investor, property_id: propertyId, shares }, network);
  return res.status(201).json({ success: true, cost: result.parsed });
}));

router.post('/shares/burn', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, investor, propertyId, shares, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'investor', 'propertyId', 'shares']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(investor)) return next(createHttpError(400, 'Invalid investor address'));
  if (typeof propertyId !== 'number' || propertyId < 1) return next(createHttpError(400, 'propertyId must be >= 1'));
  if (typeof shares !== 'number' || shares < 1) return next(createHttpError(400, 'shares must be >= 1'));
  const result = await invoke(contractId, 'burn_shares',
    { investor, property_id: propertyId, shares }, network);
  return res.json({ success: true, burned: result.parsed });
}));

router.post('/shares/transfer', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, from, to, propertyId, shares, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'from', 'to', 'propertyId', 'shares']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(from)) return next(createHttpError(400, 'Invalid from address'));
  if (!validateAddress(to)) return next(createHttpError(400, 'Invalid to address'));
  if (typeof propertyId !== 'number' || propertyId < 1) return next(createHttpError(400, 'propertyId must be >= 1'));
  if (typeof shares !== 'number' || shares < 1) return next(createHttpError(400, 'shares must be >= 1'));
  const result = await invoke(contractId, 'transfer_shares',
    { from, to, property_id: propertyId, shares }, network);
  return res.json({ success: true, output: result.parsed });
}));

router.get('/shares/holding', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const contractId = getContractId(req);
  const { investor, propertyId, network } = req.query;
  if (!validateAddress(investor)) return next(createHttpError(400, 'Invalid investor address'));
  const pid = Number(propertyId);
  if (!Number.isInteger(pid) || pid < 1) return next(createHttpError(400, 'propertyId must be >= 1'));
  const result = await invoke(contractId, 'get_holding', { investor, property_id: pid }, network);
  return res.json({ success: true, holding: result.parsed });
}));

// ── Dividends ─────────────────────────────────────────────────────────────────

router.post('/dividends/deposit', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, propertyId, amount, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'propertyId', 'amount']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (typeof propertyId !== 'number' || propertyId < 1) return next(createHttpError(400, 'propertyId must be >= 1'));
  if (typeof amount !== 'number' || amount <= 0) return next(createHttpError(400, 'amount must be > 0'));
  const result = await invoke(contractId, 'deposit_dividends',
    { admin, property_id: propertyId, amount }, network);
  return res.json({ success: true, output: result.parsed });
}));

router.post('/dividends/claim', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, investor, propertyId, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'investor', 'propertyId']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(investor)) return next(createHttpError(400, 'Invalid investor address'));
  if (typeof propertyId !== 'number' || propertyId < 1) return next(createHttpError(400, 'propertyId must be >= 1'));
  const result = await invoke(contractId, 'claim_dividends',
    { investor, property_id: propertyId }, network);
  return res.json({ success: true, claimed: result.parsed });
}));

router.get('/dividends/pending', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const contractId = getContractId(req);
  const { investor, propertyId, network } = req.query;
  if (!validateAddress(investor)) return next(createHttpError(400, 'Invalid investor address'));
  const pid = Number(propertyId);
  if (!Number.isInteger(pid) || pid < 1) return next(createHttpError(400, 'propertyId must be >= 1'));
  const result = await invoke(contractId, 'pending_dividends',
    { investor, property_id: pid }, network);
  return res.json({ success: true, pending: result.parsed });
}));

router.get('/status', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const contractId = getContractId(req);
  const { network } = req.query;
  const [paused, count] = await Promise.all([
    invoke(contractId, 'is_paused', {}, network),
    invoke(contractId, 'property_count', {}, network),
  ]);
  return res.json({ success: true, paused: paused.parsed, propertyCount: count.parsed });
}));

export default router;
