/**
 * Yield Optimizer API
 *
 * Endpoints for the Cross-Protocol Yield Optimizer with Auto-Compounding.
 * All write operations proxy to the Soroban CLI via invokeService.
 *
 * Routes:
 *   POST  /yield-optimizer/initialize
 *   POST  /yield-optimizer/protocols
 *   GET   /yield-optimizer/protocols/:id
 *   PATCH /yield-optimizer/protocols/:id/apy
 *   POST  /yield-optimizer/vaults
 *   GET   /yield-optimizer/vaults
 *   GET   /yield-optimizer/vaults/:id
 *   POST  /yield-optimizer/vaults/:id/rebalance
 *   POST  /yield-optimizer/vaults/:id/deactivate
 *   POST  /yield-optimizer/vaults/:id/deposit
 *   POST  /yield-optimizer/vaults/:id/withdraw
 *   POST  /yield-optimizer/vaults/:id/compound
 *   GET   /yield-optimizer/vaults/:id/position/:user
 *   GET   /yield-optimizer/vaults/:id/estimated/:user
 *   POST  /yield-optimizer/vaults/:id/backtest
 *   GET   /yield-optimizer/backtests/:id
 *   POST  /yield-optimizer/pause
 *   POST  /yield-optimizer/unpause
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
  if (!validateContractId(id)) throw createHttpError(400, 'Valid contractId (C + 55 chars) is required');
  return id;
}
async function invoke(contractId, functionName, args, network) {
  return invokeSorobanContract({
    requestId: `yopt-${functionName}-${Date.now()}`,
    contractId,
    functionName,
    args: args || {},
    network: network || 'testnet',
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

router.post('/protocols', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, name, baseApyBps, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'name', 'baseApyBps']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (typeof baseApyBps !== 'number' || baseApyBps < 0 || baseApyBps > 50000)
    return next(createHttpError(400, 'baseApyBps must be 0–50000'));
  const result = await invoke(contractId, 'add_protocol', { admin, name, base_apy_bps: baseApyBps }, network);
  return res.status(201).json({ success: true, protocolId: result.parsed, output: result.parsed });
}));

router.get('/protocols/:id', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid protocol id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'get_protocol', { protocol_id: id }, req.query.network);
  return res.json({ success: true, protocol: result.parsed });
}));

router.patch('/protocols/:id/apy', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid protocol id'));
  const { contractId, admin, newApyBps, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'newApyBps']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (typeof newApyBps !== 'number' || newApyBps < 0 || newApyBps > 50000)
    return next(createHttpError(400, 'newApyBps must be 0–50000'));
  const result = await invoke(contractId, 'update_protocol_apy', { admin, protocol_id: id, new_apy_bps: newApyBps }, network);
  return res.json({ success: true, message: 'APY updated', output: result.parsed });
}));

router.post('/vaults', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const { contractId, admin, name, protocolId, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'name', 'protocolId']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (typeof protocolId !== 'number' || protocolId < 1)
    return next(createHttpError(400, 'protocolId must be a positive integer'));
  const result = await invoke(contractId, 'create_vault', { admin, name, protocol_id: protocolId }, network);
  return res.status(201).json({ success: true, vaultId: result.parsed, output: result.parsed });
}));

router.get('/vaults', asyncHandler(async (req, res, next) => {
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'vault_count', {}, req.query.network);
  return res.json({ success: true, vaultCount: result.parsed });
}));

router.get('/vaults/:id', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'get_vault', { vault_id: id }, req.query.network);
  return res.json({ success: true, vault: result.parsed });
}));

router.post('/vaults/:id/rebalance', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  const { contractId, admin, newProtocolId, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'admin', 'newProtocolId']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  if (typeof newProtocolId !== 'number' || newProtocolId < 1)
    return next(createHttpError(400, 'newProtocolId must be a positive integer'));
  const result = await invoke(contractId, 'rebalance_vault', { admin, vault_id: id, new_protocol_id: newProtocolId }, network);
  return res.json({ success: true, message: 'Vault rebalanced', output: result.parsed });
}));

router.post('/vaults/:id/deactivate', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  const { contractId, admin, network } = req.body || {};
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'deactivate_vault', { admin, vault_id: id }, network);
  return res.json({ success: true, message: 'Vault deactivated', output: result.parsed });
}));

router.post('/vaults/:id/deposit', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  const { contractId, user, amount, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'user', 'amount']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(user)) return next(createHttpError(400, 'Invalid user address'));
  if (typeof amount !== 'number' || amount <= 0) return next(createHttpError(400, 'amount must be positive'));
  const result = await invoke(contractId, 'deposit', { user, vault_id: id, amount }, network);
  return res.json({ success: true, compoundedBalance: result.parsed, output: result.parsed });
}));

router.post('/vaults/:id/withdraw', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  const { contractId, user, amount, network } = req.body || {};
  const errs = requireFields(req.body, ['contractId', 'user', 'amount']);
  if (errs) return next(createHttpError(400, 'Validation failed', errs));
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(user)) return next(createHttpError(400, 'Invalid user address'));
  if (typeof amount !== 'number' || amount <= 0) return next(createHttpError(400, 'amount must be positive'));
  const result = await invoke(contractId, 'withdraw', { user, vault_id: id, amount }, network);
  return res.json({ success: true, withdrawn: result.parsed, output: result.parsed });
}));

router.post('/vaults/:id/compound', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'compound', { vault_id: id }, req.body?.network);
  return res.json({ success: true, rewardsCompounded: result.parsed, output: result.parsed });
}));

router.get('/vaults/:id/position/:user', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  if (!validateAddress(req.params.user)) return next(createHttpError(400, 'Invalid user address'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'get_position', { user: req.params.user, vault_id: id }, req.query.network);
  return res.json({ success: true, position: result.parsed });
}));

router.get('/vaults/:id/estimated/:user', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  if (!validateAddress(req.params.user)) return next(createHttpError(400, 'Invalid user address'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'estimated_balance', { user: req.params.user, vault_id: id }, req.query.network);
  return res.json({ success: true, estimatedBalance: result.parsed });
}));

router.post('/vaults/:id/backtest', rateLimitMiddleware('invoke'), asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid vault id'));
  const { contractId, admin, network } = req.body || {};
  if (!validateContractId(contractId)) return next(createHttpError(400, 'Invalid contractId'));
  if (!validateAddress(admin)) return next(createHttpError(400, 'Invalid admin address'));
  const result = await invoke(contractId, 'record_backtest', { admin, vault_id: id }, network);
  return res.status(201).json({ success: true, backtestId: result.parsed, output: result.parsed });
}));

router.get('/backtests/:id', asyncHandler(async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return next(createHttpError(400, 'Invalid backtest id'));
  const contractId = getContractId(req);
  const result = await invoke(contractId, 'get_backtest', { backtest_id: id }, req.query.network);
  return res.json({ success: true, backtest: result.parsed });
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
