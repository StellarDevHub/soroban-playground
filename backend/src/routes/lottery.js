// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// In-memory state (mirrors the on-chain contract state for the playground)
// ---------------------------------------------------------------------------

let initialized = false;
let paused = false;
let ticketPrice = 10_000_000; // 1 XLM in stroops
let adminAddress = null;
let roundCount = 0;

const rounds = new Map();       // roundId -> Round
const ticketBuyers = new Map(); // `${roundId}-${ticketId}` -> buyerAddress

const analytics = {
  totalRounds: 0,
  completedRounds: 0,
  cancelledRounds: 0,
  totalTicketsSold: 0,
  totalPrizePool: 0,
  totalPrizesClaimed: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowSecs() {
  return Math.floor(Date.now() / 1000);
}

function sha256Hex(data) {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = (Math.imul(31, hash) + data.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

function verifiableRandom(seed, drawSeq, drawTs, totalTickets) {
  const input = `${seed}:${drawSeq}:${drawTs}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % totalTickets) + 1;
}

function validateAddress(addr) {
  return typeof addr === 'string' && addr.length > 0;
}

// ---------------------------------------------------------------------------
// POST /initialize
// ---------------------------------------------------------------------------

router.post(
  '/initialize',
  asyncHandler(async (req, res) => {
    if (initialized) throw createHttpError(409, 'Contract already initialized');

    const { admin, ticketPriceStroops } = req.body || {};
    if (!validateAddress(admin)) throw createHttpError(400, 'admin address is required');

    const price = parseInt(ticketPriceStroops, 10);
    if (!price || price <= 0) throw createHttpError(400, 'ticketPriceStroops must be a positive integer');

    initialized = true;
    paused = false;
    adminAddress = admin;
    ticketPrice = price;

    res.status(200).json({ success: true, data: { admin, ticketPriceStroops: price } });
  })
);

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------

router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: {
        initialized,
        paused,
        admin: adminAddress,
        ticketPriceStroops: ticketPrice,
        ticketPriceXlm: (ticketPrice / 1e7).toFixed(7),
        roundCount,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /analytics
// ---------------------------------------------------------------------------

router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    res.json({
      success: true,
      data: {
        ...analytics,
        totalPrizePoolXlm: (analytics.totalPrizePool / 1e7).toFixed(7),
        totalPrizesClaimedXlm: (analytics.totalPrizesClaimed / 1e7).toFixed(7),
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /pause  /  POST /unpause
// ---------------------------------------------------------------------------

router.post(
  '/pause',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    const { caller } = req.body || {};
    if (caller !== adminAddress) throw createHttpError(403, 'Only admin can pause');
    paused = true;
    res.json({ success: true, data: { paused: true } });
  })
);

router.post(
  '/unpause',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    const { caller } = req.body || {};
    if (caller !== adminAddress) throw createHttpError(403, 'Only admin can unpause');
    paused = false;
    res.json({ success: true, data: { paused: false } });
  })
);

// ---------------------------------------------------------------------------
// GET /rounds
// ---------------------------------------------------------------------------

router.get(
  '/rounds',
  asyncHandler(async (req, res) => {
    const { status, limit = '20', offset = '0' } = req.query;
    let list = Array.from(rounds.values());

    if (status) {
      list = list.filter(r => r.status.toLowerCase() === status.toLowerCase());
    }

    list.sort((a, b) => b.id - a.id);

    const total = list.length;
    const paginated = list.slice(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10));

    res.json({ success: true, data: paginated, meta: { total, limit: parseInt(limit, 10), offset: parseInt(offset, 10) } });
  })
);

// ---------------------------------------------------------------------------
// POST /rounds  (start_round)
// ---------------------------------------------------------------------------

router.post(
  '/rounds',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    if (paused) throw createHttpError(400, 'Contract is paused');

    const { caller, durationSecs } = req.body || {};
    if (caller !== adminAddress) throw createHttpError(403, 'Only admin can start rounds');

    const duration = parseInt(durationSecs, 10);
    if (!duration || duration <= 0) throw createHttpError(400, 'durationSecs must be positive');

    roundCount += 1;
    const id = roundCount;
    const startTime = nowSecs();
    const endTime = startTime + duration;
    const committedSeed = sha256Hex(`${startTime}:${id}`);

    const round = {
      id,
      status: 'Open',
      startTime,
      endTime,
      ticketPriceStroops: ticketPrice,
      ticketPriceXlm: (ticketPrice / 1e7).toFixed(7),
      totalTickets: 0,
      prizePoolStroops: 0,
      prizePoolXlm: '0.0000000',
      winnerTicketId: null,
      winner: null,
      committedSeed,
      claimed: false,
    };

    rounds.set(id, round);
    analytics.totalRounds += 1;

    res.status(201).json({ success: true, data: round });
  })
);

// ---------------------------------------------------------------------------
// GET /rounds/:id
// ---------------------------------------------------------------------------

router.get(
  '/rounds/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const round = rounds.get(id);
    if (!round) throw createHttpError(404, `Round ${id} not found`);
    res.json({ success: true, data: round });
  })
);

// ---------------------------------------------------------------------------
// POST /rounds/:id/buy-ticket
// ---------------------------------------------------------------------------

router.post(
  '/rounds/:id/buy-ticket',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    if (paused) throw createHttpError(400, 'Contract is paused');

    const id = parseInt(req.params.id, 10);
    const round = rounds.get(id);
    if (!round) throw createHttpError(404, `Round ${id} not found`);
    if (round.status !== 'Open') throw createHttpError(400, 'Round is not open');
    if (nowSecs() >= round.endTime) throw createHttpError(400, 'Round has ended');

    const { buyer } = req.body || {};
    if (!validateAddress(buyer)) throw createHttpError(400, 'buyer address is required');

    round.totalTickets += 1;
    round.prizePoolStroops += round.ticketPriceStroops;
    round.prizePoolXlm = (round.prizePoolStroops / 1e7).toFixed(7);
    const ticketId = round.totalTickets;

    ticketBuyers.set(`${id}-${ticketId}`, buyer);

    analytics.totalTicketsSold += 1;
    analytics.totalPrizePool += round.ticketPriceStroops;

    res.status(201).json({ success: true, data: { ticketId, roundId: id, buyer, prizePoolXlm: round.prizePoolXlm } });
  })
);

// ---------------------------------------------------------------------------
// POST /rounds/:id/draw-winner
// ---------------------------------------------------------------------------

router.post(
  '/rounds/:id/draw-winner',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');
    if (paused) throw createHttpError(400, 'Contract is paused');

    const id = parseInt(req.params.id, 10);
    const round = rounds.get(id);
    if (!round) throw createHttpError(404, `Round ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== adminAddress) throw createHttpError(403, 'Only admin can draw winners');
    if (round.status === 'Completed') throw createHttpError(400, 'Round already drawn');
    if (round.status === 'Cancelled') throw createHttpError(400, 'Round is cancelled');
    if (nowSecs() < round.endTime) throw createHttpError(400, 'Round is still open');
    if (round.totalTickets === 0) throw createHttpError(400, 'No tickets sold');

    const drawSeq = Math.floor(Math.random() * 1_000_000);
    const drawTs = nowSecs();
    const winnerTicketId = verifiableRandom(round.committedSeed, drawSeq, drawTs, round.totalTickets);
    const winner = ticketBuyers.get(`${id}-${winnerTicketId}`);
    if (!winner) throw createHttpError(500, 'Winner lookup failed');

    round.status = 'Completed';
    round.winnerTicketId = winnerTicketId;
    round.winner = winner;

    analytics.completedRounds += 1;

    res.json({ success: true, data: { roundId: id, winner, winnerTicketId, prizePoolXlm: round.prizePoolXlm } });
  })
);

// ---------------------------------------------------------------------------
// POST /rounds/:id/claim-prize
// ---------------------------------------------------------------------------

router.post(
  '/rounds/:id/claim-prize',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');

    const id = parseInt(req.params.id, 10);
    const round = rounds.get(id);
    if (!round) throw createHttpError(404, `Round ${id} not found`);
    if (round.status !== 'Completed') throw createHttpError(400, 'Round is not completed');
    if (round.claimed) throw createHttpError(400, 'Prize already claimed');

    const { claimant } = req.body || {};
    if (!validateAddress(claimant)) throw createHttpError(400, 'claimant address is required');
    if (claimant !== round.winner) throw createHttpError(403, 'Only the winner can claim the prize');

    round.claimed = true;
    analytics.totalPrizesClaimed += round.prizePoolStroops;

    res.json({
      success: true,
      data: {
        roundId: id,
        claimant,
        prizeStroops: round.prizePoolStroops,
        prizeXlm: round.prizePoolXlm,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /rounds/:id/cancel
// ---------------------------------------------------------------------------

router.post(
  '/rounds/:id/cancel',
  asyncHandler(async (req, res) => {
    if (!initialized) throw createHttpError(400, 'Contract not initialized');

    const id = parseInt(req.params.id, 10);
    const round = rounds.get(id);
    if (!round) throw createHttpError(404, `Round ${id} not found`);

    const { caller } = req.body || {};
    if (caller !== adminAddress) throw createHttpError(403, 'Only admin can cancel rounds');
    if (round.status === 'Completed') throw createHttpError(400, 'Round already drawn');
    if (round.status === 'Cancelled') throw createHttpError(400, 'Round already cancelled');

    round.status = 'Cancelled';
    analytics.cancelledRounds += 1;

    res.json({ success: true, data: { roundId: id, status: 'Cancelled' } });
  })
);

export default router;
