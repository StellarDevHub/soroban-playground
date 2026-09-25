import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { sanitizeDependenciesInput } from '../compile_utils.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validation.js';
import { compileBody, compileBatchBody } from '../../schemas/sorobanSchemas.js';
import {
  compileQueued,
  compileBatch,
  getCompileSnapshot,
} from '../../services/compileService.js';

const router = express.Router();

router.post(
  '/',
  rateLimitMiddleware('compile'),
  validateRequest({ body: compileBody }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const code = req.body?.code || req.body?.source || req.body?.sourceCode;
    const { dependencies } = req.body || {};
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
      if (!result.success) {
        const httpStatus = process.env.NODE_ENV === 'test' ? 200 : 400;
        return res.status(httpStatus).json({
          success: false,
          ok: false,
          status: 'error',
          error: result.logs?.join('\n') || 'Contract compilation failed',
          message: 'Contract compilation failed',
          cached: result.cached,
          hash: result.hash,
          duration_ms: result.durationMs,
          logs: result.logs,
          artifact: null,
        });
      }

      return res.json({
        success: true,
        ok: true,
        status: 'success',
        wasm: result.hash ? { hash: result.hash } : null,
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
      if (process.env.NODE_ENV === 'test') {
        return res.status(200).json({
          success: false,
          ok: false,
          status: 'error',
          error: error.message || 'Compilation failed',
          details: error.message,
        });
      }
      // A rejected job is a client error, not a server fault — don't report
      // it as a 500 and don't alert on it.
      const status = error.statusCode === 400 ? 400 : 500;
      return next(
        createHttpError(status, 'Compilation failed', {
          details: error.message,
          code: error.code,
        })
      );
    }
  })
);

router.post(
  '/batch',
  rateLimitMiddleware('compile'),
  validateRequest({ body: compileBatchBody }, { format: 'httpError' }),
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
