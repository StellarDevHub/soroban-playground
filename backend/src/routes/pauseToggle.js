// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @openapi
 * tags:
 *   - name: Pause Toggle
 *     description: Emergency circuit-breaker for Soroban contracts
 */

import express from 'express';
import service from '../services/pauseToggleService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

function requireFields(body, fields) {
  const missing = fields.filter(
    (f) => body[f] === undefined || body[f] === null || body[f] === ''
  );
  return missing.length ? missing : null;
}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

/**
 * @openapi
 * /api/pause-toggle/init:
 *   post:
 *     tags: [Pause Toggle]
 *     summary: Initialize the pause-toggle contract
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin]
 *             properties:
 *               contractId: { type: string }
 *               admin: { type: string }
 *     responses:
 *       200:
 *         description: Initialized
 *       400:
 *         description: Validation error
 */
router.post('/init', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'admin']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);
  try {
    const data = await service.initialize(req.body.contractId, req.body.admin);
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/pause-toggle/pause:
 *   post:
 *     tags: [Pause Toggle]
 *     summary: Pause the contract
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, caller]
 *             properties:
 *               contractId: { type: string }
 *               caller: { type: string }
 *               reason: { type: string, description: "Optional pause reason" }
 *     responses:
 *       200:
 *         description: Paused
 *       400:
 *         description: Validation error
 */
router.post('/pause', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'caller']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);
  try {
    const data = await service.pause(
      req.body.contractId,
      req.body.caller,
      req.body.reason ?? null
    );
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/pause-toggle/unpause:
 *   post:
 *     tags: [Pause Toggle]
 *     summary: Unpause the contract
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, caller]
 *             properties:
 *               contractId: { type: string }
 *               caller: { type: string }
 *     responses:
 *       200:
 *         description: Unpaused
 */
router.post('/unpause', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'caller']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);
  try {
    const data = await service.unpause(req.body.contractId, req.body.caller);
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/pause-toggle/status:
 *   get:
 *     tags: [Pause Toggle]
 *     summary: Get the paused state
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paused state
 */
router.get('/status', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'Missing contractId');
  try {
    const paused = await service.isPaused(contractId);
    return res.json({ success: true, data: { paused } });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/pause-toggle/reason:
 *   get:
 *     tags: [Pause Toggle]
 *     summary: Get the pause reason (null if not paused or no reason given)
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pause reason
 */
router.get('/reason', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'Missing contractId');
  try {
    const reason = await service.getPauseReason(contractId);
    return res.json({ success: true, data: { reason } });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/pause-toggle/timestamp:
 *   get:
 *     tags: [Pause Toggle]
 *     summary: Get the ledger timestamp when the contract was paused (null if not paused)
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pause timestamp
 */
router.get('/timestamp', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'Missing contractId');
  try {
    const timestamp = await service.getPauseTimestamp(contractId);
    return res.json({ success: true, data: { timestamp } });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/pause-toggle/admin:
 *   get:
 *     tags: [Pause Toggle]
 *     summary: Get the admin address
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Admin address
 */
router.get('/admin', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'Missing contractId');
  try {
    const admin = await service.getAdmin(contractId);
    return res.json({ success: true, data: { admin } });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

export default router;
