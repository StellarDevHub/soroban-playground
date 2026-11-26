// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler.js';
import { notaryRateLimiter } from '../middleware/notaryRateLimiter.js';
import { validateZod } from '../middleware/validationMiddleware.js';
import {
  notarizeFile,
  verifyFile,
  revokeNotarization,
  listNotarizations,
} from '../services/notaryService.js';

const router = express.Router();

const FILE_HASH_PARAM_REGEX = /^[0-9a-fA-F]{64}$/;

const fileHashParamsSchema = z
  .object({
    fileHash: z
      .string({
        required_error: 'fileHash is required and must be a string',
        invalid_type_error: 'fileHash is required and must be a string',
      })
      .regex(
        FILE_HASH_PARAM_REGEX,
        'fileHash must be a 64-character hex string'
      ),
  })
  .strict();

const notarizeBodySchema = z
  .object({
    fileHash: z
      .string({
        required_error: 'fileHash is required and must be a string',
        invalid_type_error: 'fileHash is required and must be a string',
      })
      .regex(
        FILE_HASH_PARAM_REGEX,
        'fileHash must be a 64-character hex string'
      ),
    metadata: z
      .string({
        required_error: 'metadata is required and must be a string',
        invalid_type_error: 'metadata is required and must be a string',
      })
      .min(1, 'metadata must not be empty')
      .max(500, 'metadata must not exceed 500 characters'),
    callerAddress: z.string().min(1).max(128).optional().default('anonymous'),
  })
  .strict();

const revokeBodySchema = z
  .object({
    callerAddress: z
      .string({
        required_error: 'callerAddress is required',
        invalid_type_error: 'callerAddress is required',
      })
      .min(1, 'callerAddress is required')
      .max(128, 'callerAddress must not exceed 128 characters'),
  })
  .strict();

/**
 * POST /api/notary/notarize
 * Body: { fileHash: string, metadata: string, callerAddress?: string }
 */
router.post(
  '/notarize',
  notaryRateLimiter,
  validateZod({ body: notarizeBodySchema }, { detailFormat: 'messages' }),
  asyncHandler(async (req, res) => {
    const { fileHash, metadata, callerAddress } = req.body;
    const result = await notarizeFile(fileHash, metadata, callerAddress);
    res.status(201).json({ success: true, data: result });
  })
);

/**
 * GET /api/notary/verify/:fileHash
 */
router.get(
  '/verify/:fileHash',
  validateZod({ params: fileHashParamsSchema }, { detailFormat: 'messages' }),
  asyncHandler(async (req, res) => {
    const { fileHash } = req.params;
    const record = await verifyFile(fileHash);
    res.json({ success: true, data: record });
  })
);

/**
 * DELETE /api/notary/revoke/:fileHash
 * Body: { callerAddress: string }
 */
router.delete(
  '/revoke/:fileHash',
  validateZod(
    { params: fileHashParamsSchema, body: revokeBodySchema },
    { detailFormat: 'messages' }
  ),
  asyncHandler(async (req, res) => {
    const { fileHash } = req.params;
    const { callerAddress } = req.body;
    await revokeNotarization(fileHash, callerAddress);
    res.json({ success: true });
  })
);

/**
 * GET /api/notary/history?page=1&limit=20
 */
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 20)
    );
    const result = await listNotarizations(page, limit);
    res.json({ success: true, data: result });
  })
);

export default router;
