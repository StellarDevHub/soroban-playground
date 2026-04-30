// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * @openapi
 * tags:
 *   - name: Quadratic Voting
 *     description: Quadratic voting contract operations
 */

import express from 'express';
import qvService from '../services/quadraticVotingService.js';
import { rateLimitMiddleware } from '../middleware/rateLimiter.js';

const router = express.Router();

// ── Input validation helpers ──────────────────────────────────────────────────

function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  return missing.length ? missing : null;
}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/quadratic-voting/initialize:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Initialize the quadratic voting contract
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
 *               votingPeriod: { type: integer, description: "Voting period in seconds" }
 *               maxCredits: { type: integer, description: "Max credits per voter per proposal" }
 *     responses:
 *       200:
 *         description: Contract initialized
 *       400:
 *         description: Validation error
 */
router.post('/initialize', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'admin']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);

  const { contractId, admin, votingPeriod, maxCredits } = req.body;
  try {
    const result = await qvService.initialize(contractId, admin, votingPeriod ?? null, maxCredits ?? null);
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/proposals:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Create a new proposal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin, title, description]
 *             properties:
 *               contractId: { type: string }
 *               admin: { type: string }
 *               title: { type: string, maxLength: 32 }
 *               description: { type: string }
 *               duration: { type: integer, description: "Duration in seconds (optional)" }
 *     responses:
 *       201:
 *         description: Proposal created, returns proposal ID
 *       400:
 *         description: Validation error
 */
router.post('/proposals', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'admin', 'title', 'description']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);

  const { contractId, admin, title, description, duration } = req.body;
  if (title.length > 32) return sendError(res, 400, 'Title must be 32 characters or fewer');

  try {
    const result = await qvService.createProposal(contractId, admin, title, description, duration ?? null);
    res.status(201).json({ success: true, data: { proposalId: result } });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/proposals/{proposalId}:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Get a proposal by ID
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Proposal data
 *       400:
 *         description: Missing contractId
 *       404:
 *         description: Proposal not found
 */
router.get('/proposals/:proposalId', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'contractId query param required');

  const proposalId = parseInt(req.params.proposalId, 10);
  if (isNaN(proposalId)) return sendError(res, 400, 'proposalId must be an integer');

  try {
    const result = await qvService.getProposal(contractId, proposalId);
    res.json({ success: true, data: result });
  } catch (err) {
    const status = err.message?.includes('not found') ? 404 : 500;
    sendError(res, status, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/proposals/count:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Get total proposal count
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Proposal count
 */
router.get('/proposals/count', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'contractId query param required');

  try {
    const count = await qvService.getProposalCount(contractId);
    res.json({ success: true, data: { count } });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/proposals/{proposalId}/cancel:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Cancel an active proposal
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema: { type: integer }
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
 *         description: Proposal cancelled
 */
router.post('/proposals/:proposalId/cancel', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'admin']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);

  const proposalId = parseInt(req.params.proposalId, 10);
  if (isNaN(proposalId)) return sendError(res, 400, 'proposalId must be an integer');

  const { contractId, admin } = req.body;
  try {
    const result = await qvService.finalizeProposal(contractId, proposalId);
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/proposals/{proposalId}/finalize:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Finalize a proposal after voting ends
 *     parameters:
 *       - in: path
 *         name: proposalId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId]
 *             properties:
 *               contractId: { type: string }
 *     responses:
 *       200:
 *         description: Proposal finalized with status
 */
router.post('/proposals/:proposalId/finalize', rateLimitMiddleware('invoke'), async (req, res) => {
  const { contractId } = req.body;
  if (!contractId) return sendError(res, 400, 'contractId required');

  const proposalId = parseInt(req.params.proposalId, 10);
  if (isNaN(proposalId)) return sendError(res, 400, 'proposalId must be an integer');

  try {
    const result = await qvService.finalizeProposal(contractId, proposalId);
    res.json({ success: true, data: { status: result } });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/vote:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Cast a quadratic vote
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, voter, proposalId, credits, isFor]
 *             properties:
 *               contractId: { type: string }
 *               voter: { type: string }
 *               proposalId: { type: integer }
 *               credits: { type: integer, minimum: 1, description: "Credits to spend (votes = sqrt(credits))" }
 *               isFor: { type: boolean }
 *     responses:
 *       200:
 *         description: Vote cast, returns votes received
 *       400:
 *         description: Validation error
 */
router.post('/vote', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'voter', 'proposalId', 'credits', 'isFor']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);

  const { contractId, voter, proposalId, credits, isFor } = req.body;

  if (!Number.isInteger(credits) || credits <= 0) {
    return sendError(res, 400, 'credits must be a positive integer');
  }
  if (typeof isFor !== 'boolean') {
    return sendError(res, 400, 'isFor must be a boolean');
  }

  try {
    const result = await qvService.vote(contractId, voter, proposalId, credits, isFor);
    const votesReceived = qvService.creditsToVotes(credits);
    res.json({ success: true, data: { result, votesReceived, creditsSpent: credits } });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/whitelist:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Add or remove a voter from the whitelist
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, admin, voter, allow]
 *             properties:
 *               contractId: { type: string }
 *               admin: { type: string }
 *               voter: { type: string }
 *               allow: { type: boolean }
 *     responses:
 *       200:
 *         description: Whitelist updated
 */
router.post('/whitelist', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'admin', 'voter', 'allow']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);

  const { contractId, admin, voter, allow } = req.body;
  if (typeof allow !== 'boolean') return sendError(res, 400, 'allow must be a boolean');

  try {
    const result = await qvService.whitelistVoter(contractId, admin, voter, allow);
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/whitelist/{voter}:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Check if a voter is whitelisted
 *     parameters:
 *       - in: path
 *         name: voter
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Whitelist status
 */
router.get('/whitelist/:voter', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'contractId query param required');

  try {
    const whitelisted = await qvService.isWhitelisted(contractId, req.params.voter);
    res.json({ success: true, data: { voter: req.params.voter, whitelisted } });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/pause:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Pause the contract (emergency)
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
 *         description: Contract paused
 */
router.post('/pause', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'admin']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);

  const { contractId, admin } = req.body;
  try {
    const result = await qvService.pause(contractId, admin);
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/unpause:
 *   post:
 *     tags: [Quadratic Voting]
 *     summary: Unpause the contract
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
 *         description: Contract unpaused
 */
router.post('/unpause', rateLimitMiddleware('invoke'), async (req, res) => {
  const missing = requireFields(req.body, ['contractId', 'admin']);
  if (missing) return sendError(res, 400, `Missing fields: ${missing.join(', ')}`);

  const { contractId, admin } = req.body;
  try {
    const result = await qvService.unpause(contractId, admin);
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/status:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Get contract status (paused state)
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Contract status
 */
router.get('/status', async (req, res) => {
  const { contractId } = req.query;
  if (!contractId) return sendError(res, 400, 'contractId query param required');

  try {
    const paused = await qvService.isPaused(contractId);
    res.json({ success: true, data: { contractId, paused } });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

/**
 * @openapi
 * /api/quadratic-voting/credits-to-votes:
 *   get:
 *     tags: [Quadratic Voting]
 *     summary: Calculate votes from credits (off-chain helper)
 *     parameters:
 *       - in: query
 *         name: credits
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Votes calculation
 */
router.get('/credits-to-votes', (req, res) => {
  const credits = parseInt(req.query.credits, 10);
  if (isNaN(credits) || credits < 0) return sendError(res, 400, 'credits must be a non-negative integer');

  const votes = qvService.creditsToVotes(credits);
  res.json({ success: true, data: { credits, votes } });
});

export default router;
