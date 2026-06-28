// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import {
  listOrigins,
  addOrigin,
  removeOrigin,
} from '../services/corsWhitelistService.js';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';

const router = express.Router();

const ORIGIN_RE = /^https?:\/\/(\*\.)?[a-zA-Z0-9.-]+(:\d+)?$/;

function validateOrigin(origin) {
  return typeof origin === 'string' && ORIGIN_RE.test(origin);
}

// GET /api/cors-whitelist — list all active allowed origins
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const origins = await listOrigins();
    res.json({ success: true, data: origins });
  })
);

// POST /api/cors-whitelist — add an origin to the whitelist
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { origin, added_by } = req.body ?? {};
    if (!validateOrigin(origin)) {
      throw createHttpError(
        400,
        'origin must be a valid http(s) URL, optionally with a wildcard subdomain (*.example.com)'
      );
    }
    const entry = await addOrigin(origin, added_by ?? null);
    res.status(201).json({ success: true, data: entry });
  })
);

// DELETE /api/cors-whitelist/:origin — remove an origin (URL-encoded)
router.delete(
  '/:origin',
  asyncHandler(async (req, res) => {
    const origin = decodeURIComponent(req.params.origin);
    const removed = await removeOrigin(origin);
    if (!removed) {
      throw createHttpError(404, `Origin '${origin}' not found in whitelist`);
    }
    res.json({ success: true, message: `Origin '${origin}' removed` });
  })
);

export default router;
