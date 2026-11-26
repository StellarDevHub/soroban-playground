// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { z } from 'zod';
import {
  feeEstimator,
  FEE_CACHE_TTL_SECONDS,
  SUPPORTED_NETWORKS,
} from '../../services/oracle/feeEstimator.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validation.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

const nonNegativeInt = z.coerce.number().int().nonnegative().optional();

const feeEstimateSchema = z
  .object({
    network: z
      .string()
      .trim()
      .toLowerCase()
      .default('testnet')
      .refine(
        (network) => SUPPORTED_NETWORKS.includes(network),
        'Unsupported Stellar network'
      ),
    operationCount: z.coerce.number().int().min(1).max(1000).default(1),
    cpuInstructions: nonNegativeInt,
    memoryBytes: nonNegativeInt,
    readEntries: nonNegativeInt,
    writeEntries: nonNegativeInt,
    readBytes: nonNegativeInt,
    writeBytes: nonNegativeInt,
    transactionSizeBytes: nonNegativeInt,
    eventsSizeBytes: nonNegativeInt,
    eventSizeBytes: nonNegativeInt,
    returnValueSizeBytes: nonNegativeInt,
  })
  .strip();

export function createFeeEstimateRouter(estimator = feeEstimator) {
  const router = express.Router();

  const handleEstimate = asyncHandler(async (req, res) => {
    const input = req.method === 'GET' ? req.query : req.body;
    const estimate = await estimator.getEstimate(input);

    res.set('Cache-Control', `public, max-age=${FEE_CACHE_TTL_SECONDS}`);
    res.set('X-Fee-Estimate-Cache', estimate.cached ? 'HIT' : 'MISS');

    return res.json({
      success: true,
      data: estimate,
    });
  });

  router.get(
    '/',
    rateLimitMiddleware('read', {
      requiredScope: 'contracts:read',
    }),
    validateRequest({ query: feeEstimateSchema }, { format: 'httpError' }),
    handleEstimate
  );

  router.post(
    '/',
    rateLimitMiddleware('read', {
      requiredScope: 'contracts:read',
    }),
    validateRequest({ body: feeEstimateSchema }, { format: 'httpError' }),
    handleEstimate
  );

  return router;
}

export default createFeeEstimateRouter();
