// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Bug Bounty REST API
 *
 * Provides endpoints for managing a decentralised vulnerability disclosure
 * and reward distribution programme backed by the bug-bounty Soroban contract.
 *
 * All write operations are simulated (no live Soroban CLI calls) so the
 * playground can demonstrate the full flow without a deployed contract.
 * Replace the in-memory store with real Soroban invocations for production.
 *
 * Routes
 * ──────
 * GET    /api/bug-bounty/health          – Service health check
 * GET    /api/bug-bounty/stats           – Aggregate programme statistics
 * GET    /api/bug-bounty/reports         – List reports (with filters)
 * POST   /api/bug-bounty/reports         – Submit a new vulnerability report
 * GET    /api/bug-bounty/reports/:id     – Get a single report
 * PATCH  /api/bug-bounty/reports/:id/review   – Move to UnderReview (admin)
 * PATCH  /api/bug-bounty/reports/:id/accept   – Accept report + set reward (admin)
 * PATCH  /api/bug-bounty/reports/:id/reject   – Reject report (admin)
 * PATCH  /api/bug-bounty/reports/:id/withdraw – Reporter withdraws own report
 * POST   /api/bug-bounty/reports/:id/claim    – Reporter claims reward
 * GET    /api/bug-bounty/pool            – Pool balance info
 * POST   /api/bug-bounty/pool/fund       – Fund the bounty pool
 * GET    /api/bug-bounty/rewards         – Reward tier configuration
 * PUT    /api/bug-bounty/rewards         – Update reward tiers (admin)
 * POST   /api/bug-bounty/pause          – Pause / unpause contract (admin)
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

// ── In-memory store (replace with DB / Soroban calls in production) ───────────

const SEVERITY_ORDER = ['Low', 'Medium', 'High', 'Critical'];

const DEFAULT_REWARD_TIERS = {
  Low: 10_000_000,       // 1 XLM (in stroops)
  Medium: 50_000_000,    // 5 XLM
  High: 200_000_000,     // 20 XLM
  Critical: 1_000_000_000, // 100 XLM
};

const store = {
  reports: new Map(),
  nextId: 1,
  poolBalance: 0,
  rewardTiers: { ...DEFAULT_REWARD_TIERS },
  paused: false,
  openReporters: new Set(), // reporters with an open report
};

// ── Validation helpers ────────────────────────────────────────────────────────

function validateSeverity(severity) {
  return SEVERITY_ORDER.includes(severity);
}

function validateStatus(status) {
  return ['Pending', 'UnderReview', 'Accepted', 'Rejected', 'Paid', 'Withdrawn'].includes(status);
}

function validateAddress(addr) {
  // Stellar addresses start with G and are 56 chars, or C for contracts.
  return typeof addr === 'string' && /^[GC][A-Z0-9]{55}$/.test(addr);
}

function sanitizeString(value, maxLen = 500) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

// ── GET /health ───────────────────────────────────────────────────────────────

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      status: 'ok',
      service: 'bug-bounty',
      paused: store.paused,
      reportCount: store.reports.size,
      poolBalance: store.poolBalance,
      timestamp: new Date().toISOString(),
    });
  })
);

// ── GET /stats ────────────────────────────────────────────────────────────────

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const reports = [...store.reports.values()];

    const byStatus = {};
    const bySeverity = {};
    let totalRewarded = 0;

    for (const r of reports) {
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
      if (r.status === 'Paid') totalRewarded += r.paidAmount || 0;
    }

    res.json({
      success: true,
      data: {
        totalReports: reports.length,
        byStatus,
        bySeverity,
        poolBalance: store.poolBalance,
        totalRewarded,
        paused: store.paused,
        rewardTiers: store.rewardTiers,
      },
    });
  })
);

// ── GET /reports ──────────────────────────────────────────────────────────────

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const { status, severity, reporter, page = '1', limit = '20' } = req.query;

    let reports = [...store.reports.values()];

    if (status && validateStatus(status)) {
      reports = reports.filter((r) => r.status === status);
    }
    if (severity && validateSeverity(severity)) {
      reports = reports.filter((r) => r.severity === severity);
    }
    if (reporter) {
      reports = reports.filter((r) => r.reporter === reporter);
    }

    // Sort newest first.
    reports.sort((a, b) => b.submittedAt - a.submittedAt);

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const total = reports.length;
    const paginated = reports.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  })
);

// ── POST /reports ─────────────────────────────────────────────────────────────

router.post(
  '/reports',
  asyncHandler(async (req, res, next) => {
    if (store.paused) {
      return next(createHttpError(503, 'Bug bounty programme is currently paused'));
    }

    const { reporter, title, descriptionHash, severity } = req.body || {};

    // Input validation.
    if (!validateAddress(reporter)) {
      return next(createHttpError(400, 'Invalid reporter address'));
    }
    const cleanTitle = sanitizeString(title, 200);
    if (!cleanTitle) {
      return next(createHttpError(400, 'title must be a non-empty string (max 200 chars)'));
    }
    const cleanHash = sanitizeString(descriptionHash, 200);
    if (!cleanHash) {
      return next(createHttpError(400, 'descriptionHash must be a non-empty string'));
    }
    if (!validateSeverity(severity)) {
      return next(
        createHttpError(400, `severity must be one of: ${SEVERITY_ORDER.join(', ')}`)
      );
    }
    if (store.openReporters.has(reporter)) {
      return next(
        createHttpError(409, 'Reporter already has an open report. Close it before submitting another.')
      );
    }

    const id = store.nextId++;
    const now = Date.now();

    const report = {
      id,
      reporter,
      title: cleanTitle,
      descriptionHash: cleanHash,
      severity,
      status: 'Pending',
      rewardAmount: 0,
      paidAmount: 0,
      submittedAt: now,
      updatedAt: now,
    };

    store.reports.set(id, report);
    store.openReporters.add(reporter);

    res.status(201).json({
      success: true,
      message: 'Vulnerability report submitted successfully',
      data: report,
    });
  })
);

// ── GET /reports/:id ──────────────────────────────────────────────────────────

router.get(
  '/reports/:id',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
      return next(createHttpError(400, 'Invalid report ID'));
    }
    const report = store.reports.get(id);
    if (!report) {
      return next(createHttpError(404, `Report #${id} not found`));
    }
    res.json({ success: true, data: report });
  })
);

// ── PATCH /reports/:id/review ─────────────────────────────────────────────────

router.patch(
  '/reports/:id/review',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { adminAddress } = req.body || {};

    if (!validateAddress(adminAddress)) {
      return next(createHttpError(400, 'Invalid adminAddress'));
    }

    const report = store.reports.get(id);
    if (!report) return next(createHttpError(404, `Report #${id} not found`));
    if (report.status !== 'Pending') {
      return next(createHttpError(409, `Report is not Pending (current: ${report.status})`));
    }
    if (store.paused) {
      return next(createHttpError(503, 'Contract is paused'));
    }

    report.status = 'UnderReview';
    report.updatedAt = Date.now();

    res.json({ success: true, message: 'Report moved to UnderReview', data: report });
  })
);

// ── PATCH /reports/:id/accept ─────────────────────────────────────────────────

router.patch(
  '/reports/:id/accept',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { adminAddress, reward } = req.body || {};

    if (!validateAddress(adminAddress)) {
      return next(createHttpError(400, 'Invalid adminAddress'));
    }

    const report = store.reports.get(id);
    if (!report) return next(createHttpError(404, `Report #${id} not found`));
    if (report.status !== 'Pending' && report.status !== 'UnderReview') {
      return next(createHttpError(409, `Cannot accept report with status: ${report.status}`));
    }
    if (store.paused) {
      return next(createHttpError(503, 'Contract is paused'));
    }

    const rewardAmount =
      reward != null
        ? parseInt(reward, 10)
        : store.rewardTiers[report.severity];

    if (!Number.isInteger(rewardAmount) || rewardAmount <= 0) {
      return next(createHttpError(400, 'reward must be a positive integer (stroops)'));
    }
    if (store.poolBalance < rewardAmount) {
      return next(
        createHttpError(402, `Insufficient pool balance. Pool: ${store.poolBalance}, Required: ${rewardAmount}`)
      );
    }

    // Reserve reward from pool.
    store.poolBalance -= rewardAmount;
    report.status = 'Accepted';
    report.rewardAmount = rewardAmount;
    report.updatedAt = Date.now();

    res.json({ success: true, message: 'Report accepted', data: report });
  })
);

// ── PATCH /reports/:id/reject ─────────────────────────────────────────────────

router.patch(
  '/reports/:id/reject',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { adminAddress } = req.body || {};

    if (!validateAddress(adminAddress)) {
      return next(createHttpError(400, 'Invalid adminAddress'));
    }

    const report = store.reports.get(id);
    if (!report) return next(createHttpError(404, `Report #${id} not found`));
    if (report.status !== 'Pending' && report.status !== 'UnderReview') {
      return next(createHttpError(409, `Cannot reject report with status: ${report.status}`));
    }

    report.status = 'Rejected';
    report.updatedAt = Date.now();
    store.openReporters.delete(report.reporter);

    res.json({ success: true, message: 'Report rejected', data: report });
  })
);

// ── PATCH /reports/:id/withdraw ───────────────────────────────────────────────

router.patch(
  '/reports/:id/withdraw',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { reporter } = req.body || {};

    if (!validateAddress(reporter)) {
      return next(createHttpError(400, 'Invalid reporter address'));
    }

    const report = store.reports.get(id);
    if (!report) return next(createHttpError(404, `Report #${id} not found`));
    if (report.reporter !== reporter) {
      return next(createHttpError(403, 'Only the original reporter can withdraw this report'));
    }
    if (report.status !== 'Pending') {
      return next(createHttpError(409, `Can only withdraw Pending reports (current: ${report.status})`));
    }

    report.status = 'Withdrawn';
    report.updatedAt = Date.now();
    store.openReporters.delete(reporter);

    res.json({ success: true, message: 'Report withdrawn', data: report });
  })
);

// ── POST /reports/:id/claim ───────────────────────────────────────────────────

router.post(
  '/reports/:id/claim',
  asyncHandler(async (req, res, next) => {
    const id = parseInt(req.params.id, 10);
    const { reporter, tokenAddress } = req.body || {};

    if (!validateAddress(reporter)) {
      return next(createHttpError(400, 'Invalid reporter address'));
    }
    if (!validateAddress(tokenAddress)) {
      return next(createHttpError(400, 'Invalid tokenAddress'));
    }

    const report = store.reports.get(id);
    if (!report) return next(createHttpError(404, `Report #${id} not found`));
    if (report.reporter !== reporter) {
      return next(createHttpError(403, 'Only the original reporter can claim this reward'));
    }
    if (report.status !== 'Accepted') {
      return next(createHttpError(409, `Report must be Accepted to claim (current: ${report.status})`));
    }
    if (report.rewardAmount <= 0) {
      return next(createHttpError(409, 'No reward to claim'));
    }

    const payout = report.rewardAmount;
    report.paidAmount = payout;
    report.rewardAmount = 0;
    report.status = 'Paid';
    report.updatedAt = Date.now();
    store.openReporters.delete(reporter);

    res.json({
      success: true,
      message: `Reward of ${payout} stroops claimed successfully`,
      data: {
        report,
        payout,
        txSimulated: true,
        txHash: `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`,
      },
    });
  })
);

// ── GET /pool ─────────────────────────────────────────────────────────────────

router.get(
  '/pool',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: {
        balance: store.poolBalance,
        balanceXlm: (store.poolBalance / 10_000_000).toFixed(7),
        paused: store.paused,
      },
    });
  })
);

// ── POST /pool/fund ───────────────────────────────────────────────────────────

router.post(
  '/pool/fund',
  asyncHandler(async (req, res, next) => {
    if (store.paused) {
      return next(createHttpError(503, 'Contract is paused'));
    }

    const { funder, tokenAddress, amount } = req.body || {};

    if (!validateAddress(funder)) {
      return next(createHttpError(400, 'Invalid funder address'));
    }
    if (!validateAddress(tokenAddress)) {
      return next(createHttpError(400, 'Invalid tokenAddress'));
    }
    const amountInt = parseInt(amount, 10);
    if (!Number.isInteger(amountInt) || amountInt <= 0) {
      return next(createHttpError(400, 'amount must be a positive integer (stroops)'));
    }

    store.poolBalance += amountInt;

    res.json({
      success: true,
      message: `Pool funded with ${amountInt} stroops`,
      data: {
        funder,
        amount: amountInt,
        newBalance: store.poolBalance,
        txSimulated: true,
      },
    });
  })
);

// ── GET /rewards ──────────────────────────────────────────────────────────────

router.get(
  '/rewards',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: {
        tiers: store.rewardTiers,
        tiersXlm: Object.fromEntries(
          Object.entries(store.rewardTiers).map(([k, v]) => [k, (v / 10_000_000).toFixed(7)])
        ),
      },
    });
  })
);

// ── PUT /rewards ──────────────────────────────────────────────────────────────

router.put(
  '/rewards',
  asyncHandler(async (req, res, next) => {
    const { adminAddress, tiers } = req.body || {};

    if (!validateAddress(adminAddress)) {
      return next(createHttpError(400, 'Invalid adminAddress'));
    }
    if (!tiers || typeof tiers !== 'object') {
      return next(createHttpError(400, 'tiers must be an object'));
    }

    const updated = {};
    for (const [severity, amount] of Object.entries(tiers)) {
      if (!validateSeverity(severity)) {
        return next(createHttpError(400, `Invalid severity: ${severity}`));
      }
      const amountInt = parseInt(amount, 10);
      if (!Number.isInteger(amountInt) || amountInt <= 0) {
        return next(createHttpError(400, `Invalid amount for ${severity}: must be positive integer`));
      }
      updated[severity] = amountInt;
    }

    Object.assign(store.rewardTiers, updated);

    res.json({
      success: true,
      message: 'Reward tiers updated',
      data: { tiers: store.rewardTiers },
    });
  })
);

// ── POST /pause ───────────────────────────────────────────────────────────────

router.post(
  '/pause',
  asyncHandler(async (req, res, next) => {
    const { adminAddress, paused } = req.body || {};

    if (!validateAddress(adminAddress)) {
      return next(createHttpError(400, 'Invalid adminAddress'));
    }
    if (typeof paused !== 'boolean') {
      return next(createHttpError(400, 'paused must be a boolean'));
    }

    store.paused = paused;

    res.json({
      success: true,
      message: paused ? 'Contract paused' : 'Contract unpaused',
      data: { paused: store.paused },
    });
  })
);

export default router;
