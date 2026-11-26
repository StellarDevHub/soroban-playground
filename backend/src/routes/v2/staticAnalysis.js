// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import { z } from 'zod';
import {
  staticAnalysisService,
  RULES,
} from '../../services/analyzer/staticAnalysisService.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validation.js';
import { asyncHandler } from '../../middleware/errorHandler.js';

const fileSchema = z.object({
  path: z.string().trim().min(1).max(512),
  content: z.string().min(1),
});

const analysisSchema = z
  .object({
    files: z.array(fileSchema).min(1).max(50).optional(),
    contracts: z.record(z.string(), z.string()).optional(),
    source: z.string().min(1).optional(),
    path: z.string().trim().min(1).max(512).optional(),
    format: z.enum(['json', 'sarif']).default('json'),
    sandbox: z.boolean().optional(),
    maxFileTimeMs: z.coerce.number().int().min(1).max(10_000).optional(),
    maxTotalTimeMs: z.coerce.number().int().min(1).max(30_000).optional(),
  })
  .refine((value) => Boolean(value.files || value.contracts || value.source), {
    message: 'Provide files[], contracts{}, or a source string',
    path: ['files'],
  });

export function createStaticAnalysisRouter(analyzer = staticAnalysisService) {
  const router = express.Router();

  const handleAnalysis = asyncHandler(async (req, res) => {
    const {
      format = 'json',
      sandbox,
      maxFileTimeMs,
      maxTotalTimeMs,
      ...input
    } = req.body;

    const requestedFormat = req.query.format === 'sarif' ? 'sarif' : format;
    const result = await analyzer.analyze(input, {
      sandbox,
      maxFileTimeMs,
      maxTotalTimeMs,
    });
    const sarif = analyzer.toSarif(result);

    res.set('Cache-Control', 'no-store');
    res.set('X-Analysis-Duration-Ms', String(result.durationMs));

    if (requestedFormat === 'sarif') {
      return res.type('application/sarif+json').json(sarif);
    }

    return res.json({
      success: true,
      data: {
        ...result,
        sarif,
      },
    });
  });

  router.get('/rules', (_req, res) => {
    res.json({
      success: true,
      data: RULES,
    });
  });

  router.post(
    '/',
    rateLimitMiddleware('read', {
      requiredScope: 'contracts:read',
    }),
    validateRequest({ body: analysisSchema }, { format: 'httpError' }),
    handleAnalysis
  );

  return router;
}

export default createStaticAnalysisRouter();
