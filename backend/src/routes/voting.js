import express from 'express';
import { body, param, query, validationResult } from 'express-validator';
import votingService from '../services/votingService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { rateLimiter } from '../middleware/rateLimiter.js';

const router = express.Router();

// Validation middleware
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Create proposal
router.post(
  '/proposals',
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 10 }),
  [
    body('title').isString().trim().isLength({ min: 3, max: 100 }),
    body('description').isString().trim().isLength({ min: 10, max: 5000 }),
    body('duration').isInt({ min: 3600, max: 2592000 }),
    body('creator').isString().trim(),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { title, description, duration, creator } = req.body;
    const proposal = await votingService.createProposal({
      title,
      description,
      duration,
      creator,
    });
    res.status(201).json({ success: true, data: proposal });
  })
);

// Get all proposals with pagination
router.get(
  '/proposals',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(['active', 'ended', 'all']),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const status = req.query.status || 'all';
    
    const result = await votingService.getProposals({ page, limit, status });
    res.json({ success: true, data: result });
  })
);

// Get proposal by ID
router.get(
  '/proposals/:id',
  [param('id').isInt({ min: 1 })],
  validateRequest,
  asyncHandler(async (req, res) => {
    const proposalId = parseInt(req.params.id);
    const proposal = await votingService.getProposal(proposalId);
    
    if (!proposal) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }
    
    res.json({ success: true, data: proposal });
  })
);

// Commit vote (privacy phase)
router.post(
  '/proposals/:id/commit',
  rateLimiter({ windowMs: 60 * 1000, max: 5 }),
  [
    param('id').isInt({ min: 1 }),
    body('voter').isString().trim(),
    body('commitmentHash').isString().isLength({ min: 64, max: 64 }),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const proposalId = parseInt(req.params.id);
    const { voter, commitmentHash } = req.body;
    
    const result = await votingService.commitVote({
      proposalId,
      voter,
      commitmentHash,
    });
    
    res.json({ success: true, data: result });
  })
);

// Reveal vote
router.post(
  '/proposals/:id/reveal',
  rateLimiter({ windowMs: 60 * 1000, max: 5 }),
  [
    param('id').isInt({ min: 1 }),
    body('voter').isString().trim(),
    body('credits').isInt({ min: 1, max: 10000 }),
    body('isFor').isBoolean(),
    body('salt').isString().isLength({ min: 64, max: 64 }),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const proposalId = parseInt(req.params.id);
    const { voter, credits, isFor, salt } = req.body;
    
    const result = await votingService.revealVote({
      proposalId,
      voter,
      credits,
      isFor,
      salt,
    });
    
    res.json({ success: true, data: result });
  })
);

// Finalize proposal
router.post(
  '/proposals/:id/finalize',
  [param('id').isInt({ min: 1 })],
  validateRequest,
  asyncHandler(async (req, res) => {
    const proposalId = parseInt(req.params.id);
    const result = await votingService.finalizeProposal(proposalId);
    res.json({ success: true, data: result });
  })
);

// Get user votes
router.get(
  '/users/:address/votes',
  [
    param('address').isString().trim(),
    query('proposalId').optional().isInt({ min: 1 }),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { address } = req.params;
    const proposalId = req.query.proposalId ? parseInt(req.query.proposalId) : null;
    
    const votes = await votingService.getUserVotes(address, proposalId);
    res.json({ success: true, data: votes });
  })
);

// Whitelist user
router.post(
  '/whitelist',
  rateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }),
  [
    body('admin').isString().trim(),
    body('user').isString().trim(),
    body('initialCredits').isInt({ min: 0, max: 100000 }),
  ],
  validateRequest,
  asyncHandler(async (req, res) => {
    const { admin, user, initialCredits } = req.body;
    const result = await votingService.whitelistUser({ admin, user, initialCredits });
    res.json({ success: true, data: result });
  })
);

// Get voting statistics
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const stats = await votingService.getVotingStats();
    res.json({ success: true, data: stats });
  })
);

// Health check
router.get('/health', (req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: Date.now() });
});

export default router;
