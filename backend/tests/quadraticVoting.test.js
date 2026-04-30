// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import { jest } from '@jest/globals';

// Mock the quadratic voting service
jest.unstable_mockModule('../src/services/quadraticVotingService.js', () => ({
  default: {
    initialize: jest.fn(),
    createProposal: jest.fn(),
    whitelistVoter: jest.fn(),
    vote: jest.fn(),
    finalizeProposal: jest.fn(),
    getProposal: jest.fn(),
    getProposalCount: jest.fn(),
    isWhitelisted: jest.fn(),
    getUserCredits: jest.fn(),
    pause: jest.fn(),
    unpause: jest.fn(),
    isPaused: jest.fn(),
    creditsToVotes: jest.fn((c) => Math.floor(Math.sqrt(c))),
  },
}));

// Mock rate limiter middleware
jest.unstable_mockModule('../src/middleware/rateLimiter.js', () => ({
  rateLimitMiddleware: () => (_req, _res, next) => next(),
}));

const { default: qvService } = await import('../src/services/quadraticVotingService.js');
const { default: quadraticVotingRoute } = await import('../src/routes/quadraticVoting.js');

import express from 'express';
import request from 'supertest';

const app = express();
app.use(express.json());
app.use('/api/quadratic-voting', quadraticVotingRoute);

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADMIN = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const VOTER = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

beforeEach(() => jest.clearAllMocks());

// ── POST /initialize ──────────────────────────────────────────────────────────

describe('POST /api/quadratic-voting/initialize', () => {
  it('initializes contract successfully', async () => {
    qvService.initialize.mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/quadratic-voting/initialize')
      .send({ contractId: CONTRACT_ID, admin: ADMIN });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(qvService.initialize).toHaveBeenCalledWith(CONTRACT_ID, ADMIN, null, null);
  });

  it('returns 400 when contractId is missing', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/initialize')
      .send({ admin: ADMIN });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/contractId/);
  });

  it('returns 400 when admin is missing', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/initialize')
      .send({ contractId: CONTRACT_ID });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('passes optional votingPeriod and maxCredits', async () => {
    qvService.initialize.mockResolvedValue({});

    await request(app)
      .post('/api/quadratic-voting/initialize')
      .send({ contractId: CONTRACT_ID, admin: ADMIN, votingPeriod: 3600, maxCredits: 50 });

    expect(qvService.initialize).toHaveBeenCalledWith(CONTRACT_ID, ADMIN, 3600, 50);
  });
});

// ── POST /proposals ───────────────────────────────────────────────────────────

describe('POST /api/quadratic-voting/proposals', () => {
  it('creates a proposal and returns 201', async () => {
    qvService.createProposal.mockResolvedValue(0);

    const res = await request(app)
      .post('/api/quadratic-voting/proposals')
      .send({ contractId: CONTRACT_ID, admin: ADMIN, title: 'Test', description: 'Desc' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.proposalId).toBe(0);
  });

  it('returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/proposals')
      .send({ contractId: CONTRACT_ID, admin: ADMIN });

    expect(res.status).toBe(400);
  });

  it('returns 400 when title exceeds 32 chars', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/proposals')
      .send({
        contractId: CONTRACT_ID,
        admin: ADMIN,
        title: 'A'.repeat(33),
        description: 'Desc',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/32/);
  });

  it('returns 500 on service error', async () => {
    qvService.createProposal.mockRejectedValue(new Error('Contract error'));

    const res = await request(app)
      .post('/api/quadratic-voting/proposals')
      .send({ contractId: CONTRACT_ID, admin: ADMIN, title: 'Test', description: 'Desc' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Contract error');
  });
});

// ── GET /proposals/:id ────────────────────────────────────────────────────────

describe('GET /api/quadratic-voting/proposals/:proposalId', () => {
  it('returns proposal data', async () => {
    const mockProposal = { id: 0, title: 'Test', status: 'Active', votes_for: 3, votes_against: 0 };
    qvService.getProposal.mockResolvedValue(mockProposal);

    const res = await request(app)
      .get('/api/quadratic-voting/proposals/0')
      .query({ contractId: CONTRACT_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(mockProposal);
  });

  it('returns 400 when contractId is missing', async () => {
    const res = await request(app).get('/api/quadratic-voting/proposals/0');
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer proposalId', async () => {
    const res = await request(app)
      .get('/api/quadratic-voting/proposals/abc')
      .query({ contractId: CONTRACT_ID });
    expect(res.status).toBe(400);
  });
});

// ── POST /vote ────────────────────────────────────────────────────────────────

describe('POST /api/quadratic-voting/vote', () => {
  it('casts a vote and returns votes received', async () => {
    qvService.vote.mockResolvedValue({ success: true });
    qvService.creditsToVotes.mockReturnValue(3);

    const res = await request(app)
      .post('/api/quadratic-voting/vote')
      .send({ contractId: CONTRACT_ID, voter: VOTER, proposalId: 0, credits: 9, isFor: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.votesReceived).toBe(3);
    expect(res.body.data.creditsSpent).toBe(9);
  });

  it('returns 400 for missing fields', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/vote')
      .send({ contractId: CONTRACT_ID, voter: VOTER });

    expect(res.status).toBe(400);
  });

  it('returns 400 for non-positive credits', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/vote')
      .send({ contractId: CONTRACT_ID, voter: VOTER, proposalId: 0, credits: 0, isFor: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/positive integer/);
  });

  it('returns 400 when isFor is not boolean', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/vote')
      .send({ contractId: CONTRACT_ID, voter: VOTER, proposalId: 0, credits: 4, isFor: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boolean/);
  });
});

// ── POST /whitelist ───────────────────────────────────────────────────────────

describe('POST /api/quadratic-voting/whitelist', () => {
  it('whitelists a voter', async () => {
    qvService.whitelistVoter.mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/quadratic-voting/whitelist')
      .send({ contractId: CONTRACT_ID, admin: ADMIN, voter: VOTER, allow: true });

    expect(res.status).toBe(200);
    expect(qvService.whitelistVoter).toHaveBeenCalledWith(CONTRACT_ID, ADMIN, VOTER, true);
  });

  it('returns 400 when allow is not boolean', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/whitelist')
      .send({ contractId: CONTRACT_ID, admin: ADMIN, voter: VOTER, allow: 'yes' });

    expect(res.status).toBe(400);
  });
});

// ── GET /whitelist/:voter ─────────────────────────────────────────────────────

describe('GET /api/quadratic-voting/whitelist/:voter', () => {
  it('returns whitelist status', async () => {
    qvService.isWhitelisted.mockResolvedValue(true);

    const res = await request(app)
      .get(`/api/quadratic-voting/whitelist/${VOTER}`)
      .query({ contractId: CONTRACT_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.whitelisted).toBe(true);
  });
});

// ── POST /pause & /unpause ────────────────────────────────────────────────────

describe('POST /api/quadratic-voting/pause', () => {
  it('pauses the contract', async () => {
    qvService.pause.mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/quadratic-voting/pause')
      .send({ contractId: CONTRACT_ID, admin: ADMIN });

    expect(res.status).toBe(200);
    expect(qvService.pause).toHaveBeenCalledWith(CONTRACT_ID, ADMIN);
  });
});

describe('POST /api/quadratic-voting/unpause', () => {
  it('unpauses the contract', async () => {
    qvService.unpause.mockResolvedValue({ success: true });

    const res = await request(app)
      .post('/api/quadratic-voting/unpause')
      .send({ contractId: CONTRACT_ID, admin: ADMIN });

    expect(res.status).toBe(200);
    expect(qvService.unpause).toHaveBeenCalledWith(CONTRACT_ID, ADMIN);
  });
});

// ── GET /status ───────────────────────────────────────────────────────────────

describe('GET /api/quadratic-voting/status', () => {
  it('returns paused status', async () => {
    qvService.isPaused.mockResolvedValue(false);

    const res = await request(app)
      .get('/api/quadratic-voting/status')
      .query({ contractId: CONTRACT_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.paused).toBe(false);
  });

  it('returns 400 when contractId is missing', async () => {
    const res = await request(app).get('/api/quadratic-voting/status');
    expect(res.status).toBe(400);
  });
});

// ── GET /credits-to-votes ─────────────────────────────────────────────────────

describe('GET /api/quadratic-voting/credits-to-votes', () => {
  it('calculates votes from credits', async () => {
    qvService.creditsToVotes.mockReturnValue(3);

    const res = await request(app)
      .get('/api/quadratic-voting/credits-to-votes')
      .query({ credits: 9 });

    expect(res.status).toBe(200);
    expect(res.body.data.votes).toBe(3);
    expect(res.body.data.credits).toBe(9);
  });

  it('returns 400 for invalid credits', async () => {
    const res = await request(app)
      .get('/api/quadratic-voting/credits-to-votes')
      .query({ credits: 'abc' });

    expect(res.status).toBe(400);
  });
});

// ── POST /proposals/:id/finalize ──────────────────────────────────────────────

describe('POST /api/quadratic-voting/proposals/:proposalId/finalize', () => {
  it('finalizes a proposal', async () => {
    qvService.finalizeProposal.mockResolvedValue('Passed');

    const res = await request(app)
      .post('/api/quadratic-voting/proposals/0/finalize')
      .send({ contractId: CONTRACT_ID });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Passed');
  });

  it('returns 400 when contractId is missing', async () => {
    const res = await request(app)
      .post('/api/quadratic-voting/proposals/0/finalize')
      .send({});

    expect(res.status).toBe(400);
  });
});
