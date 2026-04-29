import express from 'express';
import { asyncHandler, createHttpError } from '../../middleware/errorHandler.js';
import { sanitizeDependenciesInput } from '../compile_utils.js';
import {
  compileQueued,
  compileBatch,
  getCompileSnapshot,
} from '../../services/compileService.js';

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res, next) => {
    const { code, dependencies } = req.body || {};
    if (!code) {
      return next(createHttpError(400, 'No code provided'));
    }

    const depValidation = sanitizeDependenciesInput(dependencies);
    if (!depValidation.ok) {
      return next(
        createHttpError(400, depValidation.error, depValidation.details)
      );
    }

    try {
      const result = await compileQueued({
        requestId: `compile-${Date.now()}`,
        code,
        dependencies: depValidation.deps,
      });
      return res.json({
        success: true,
        status: 'success',
        message: result.cached
          ? 'Contract compiled from cache'
          : 'Contract compiled successfully',
        cached: result.cached,
        hash: result.hash,
        duration_ms: result.durationMs,
        logs: result.logs,
        artifact: {
          name: result.artifact.name,
          size_bytes: result.artifact.sizeBytes,
          path: result.artifact.path,
        },
      });
    } catch (error) {
      return next(
        createHttpError(500, 'Compilation failed', { details: error.message })
      );
    }
  })
);

router.post(
  '/batch',
  asyncHandler(async (req, res, next) => {
    const { contracts } = req.body || {};
    if (!Array.isArray(contracts) || contracts.length === 0) {
      return next(createHttpError(400, 'contracts must be a non-empty array'));
    }
    const jobs = contracts.slice(0, 4).map((contract, index) => ({
      requestId: `batch-compile-${Date.now()}-${index}`,
      code: contract.code,
      dependencies: contract.dependencies || {},
    }));
    const results = await compileBatch(jobs);
    return res.json({
      success: true,
      status: 'success',
      queue_length: 0,
      active_workers: Math.min(4, contracts.length),
      results: results.map((result, index) => ({
        contract_index: index,
        ...result,
        duration_ms: result.durationMs, // Map internal field to v2
      })),
    });
  })
);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = await getCompileSnapshot();
    return res.json({
      success: true,
      status: 'success',
      stats,
    });
  })
);

export default router;
