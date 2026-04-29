// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';

import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { getOracleService } from '../services/oracle/oracleService.js';

const router = express.Router();

router.post(
  '/proofs',
  asyncHandler(async (req, res) => {
    const { payload, metadata, wait } = req.body || {};
    if (payload === undefined || payload === null) {
      throw createHttpError(400, 'payload is required');
    }
    const svc = getOracleService();
    if (wait) {
      const proof = await svc.submitProofAndWait(payload, { metadata });
      return res.status(200).json({ success: true, data: proof });
    }
    const proof = await svc.submitProof(payload, { metadata });
    return res.status(202).json({ success: true, data: proof });
  })
);

router.get(
  '/proofs',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const proofs = getOracleService().listProofs({ limit });
    res.json({ success: true, data: proofs });
  })
);

router.get(
  '/proofs/:id',
  asyncHandler(async (req, res) => {
    const proof = getOracleService().getProof(req.params.id);
    if (!proof) throw createHttpError(404, 'Proof not found');
    res.json({ success: true, data: proof });
  })
);

router.get(
  '/nodes',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getOracleService().listNodes() });
  })
);

router.get(
  '/health',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: getOracleService().health() });
  })
);

export default router;
