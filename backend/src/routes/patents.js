// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

/**
 * Patent Registry Routes
 *
 * POST /api/patents/file          – file a new patent
 * POST /api/patents/:id/activate  – activate a pending patent (admin)
 * POST /api/patents/:id/revoke    – revoke an active patent (admin)
 * POST /api/patents/:id/transfer  – transfer patent ownership
 * POST /api/patents/:id/license   – grant a license on a patent
 * POST /api/patents/disputes      – file a dispute
 * POST /api/patents/disputes/:id/resolve – resolve a dispute (admin)
 * POST /api/patents/pause         – pause contract (admin)
 * POST /api/patents/unpause       – unpause contract (admin)
 *
 * GET  /api/patents/:id           – get patent by ID
 * GET  /api/patents/licenses/:id  – get license by ID
 * GET  /api/patents/disputes/:id  – get dispute by ID
 * GET  /api/patents/stats         – patent/license/dispute counts + paused flag
 */

import express from 'express';
import { asyncHandler, createHttpError } from '../../middleware/errorHandler.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import * as patentService from '../../services/patentService.js';

const router = express.Router();

// ── Validation helpers ────────────────────────────────────────────────────────

function requireFields(body, fields) {
  const missing = fields.filter((f) => !body[f]);
  return missing.length ? missing.map((f) => `${f} is required`) : null;
}

function parseId(param) {
  const n = parseInt(param, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Write routes ──────────────────────────────────────────────────────────────

router.post(
  '/file',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['inventor', 'title', 'description', 'expiryDate']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.filePatent(req.body);
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/:id/activate',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const patentId = parseId(req.params.id);
    if (!patentId) return next(createHttpError(400, 'Invalid patent ID'));
    const errs = requireFields(req.body, ['admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.activatePatent({ admin: req.body.admin, patentId });
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/:id/revoke',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const patentId = parseId(req.params.id);
    if (!patentId) return next(createHttpError(400, 'Invalid patent ID'));
    const errs = requireFields(req.body, ['admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.revokePatent({ admin: req.body.admin, patentId });
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/:id/transfer',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const patentId = parseId(req.params.id);
    if (!patentId) return next(createHttpError(400, 'Invalid patent ID'));
    const errs = requireFields(req.body, ['owner', 'newOwner']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.transferPatent({
      owner: req.body.owner,
      patentId,
      newOwner: req.body.newOwner,
    });
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/:id/license',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const patentId = parseId(req.params.id);
    if (!patentId) return next(createHttpError(400, 'Invalid patent ID'));
    const errs = requireFields(req.body, ['owner', 'licensee', 'licenseType', 'fee', 'expiryDate']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.grantLicense({ ...req.body, patentId });
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/disputes',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['claimant', 'patentId', 'reason']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.fileDispute(req.body);
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/disputes/:id/resolve',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const disputeId = parseId(req.params.id);
    if (!disputeId) return next(createHttpError(400, 'Invalid dispute ID'));
    const errs = requireFields(req.body, ['admin', 'resolution']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.resolveDispute({ ...req.body, disputeId });
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/pause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.pauseContract(req.body);
    res.json({ success: true, data: result.output });
  })
);

router.post(
  '/unpause',
  rateLimitMiddleware('invoke'),
  asyncHandler(async (req, res, next) => {
    const errs = requireFields(req.body, ['admin']);
    if (errs) return next(createHttpError(400, 'Validation failed', errs));

    const result = await patentService.unpauseContract(req.body);
    res.json({ success: true, data: result.output });
  })
);

// ── Read routes ───────────────────────────────────────────────────────────────

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [patents, licenses, disputes, paused] = await Promise.all([
      patentService.getPatentCount(),
      patentService.getLicenseCount(),
      patentService.getDisputeCount(),
      patentService.getIsPaused(),
    ]);
    res.json({
      success: true,
      data: {
        patentCount: patents.output,
        licenseCount: licenses.output,
        disputeCount: disputes.output,
        paused: paused.output,
      },
    });
  })
);

router.get(
  '/licenses/:id',
  asyncHandler(async (req, res, next) => {
    const licenseId = parseId(req.params.id);
    if (!licenseId) return next(createHttpError(400, 'Invalid license ID'));
    const result = await patentService.getLicense(licenseId);
    res.json({ success: true, data: result.output });
  })
);

router.get(
  '/disputes/:id',
  asyncHandler(async (req, res, next) => {
    const disputeId = parseId(req.params.id);
    if (!disputeId) return next(createHttpError(400, 'Invalid dispute ID'));
    const result = await patentService.getDispute(disputeId);
    res.json({ success: true, data: result.output });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res, next) => {
    const patentId = parseId(req.params.id);
    if (!patentId) return next(createHttpError(400, 'Invalid patent ID'));
    const result = await patentService.getPatent(patentId);
    res.json({ success: true, data: result.output });
  })
);

export default router;
