import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { sanitizeDependenciesInput } from '../compile_utils.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import {
  compileQueued,
  compileBatch,
  getCompileSnapshot,
} from '../../services/compileService.js';
import config from '../../config/index.js';

const router = express.Router();
const CODE_ENCODING = 'utf8';

function validateSourceCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    return {
      ok: false,
      error: 'No code provided',
    };
  }

  const bytes = Buffer.byteLength(code, CODE_ENCODING);
  if (bytes > config.compile.maxSourceBytes) {
    return {
      ok: false,
      error: `Code exceeds max size of ${config.compile.maxSourceBytes} bytes`,
      details: { maxSourceBytes: config.compile.maxSourceBytes, actualBytes: bytes },
    };
  }

  return { ok: true };
}

router.post(
  '/',
  rateLimitMiddleware('compile'),
  asyncHandler(async (req, res, next) => {
    const { code, dependencies } = req.body || {};
    const codeValidation = validateSourceCode(code);
    if (!codeValidation.ok) {
      return next(
        createHttpError(400, codeValidation.error, codeValidation.details)
      );
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
        durationMs: result.durationMs,
        logs: result.logs,
        artifact: {
          name: result.artifact.name,
          sizeBytes: result.artifact.sizeBytes,
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
  rateLimitMiddleware('compile'),
  asyncHandler(async (req, res, next) => {
    const { contracts } = req.body || {};
    if (!Array.isArray(contracts) || contracts.length === 0) {
      return next(createHttpError(400, 'contracts must be a non-empty array'));
    }
    const jobs = [];
    for (const [index, contract] of contracts.slice(0, 4).entries()) {
      const codeValidation = validateSourceCode(contract?.code);
      if (!codeValidation.ok) {
        return next(
          createHttpError(
            400,
            `Invalid code for contract at index ${index}: ${codeValidation.error}`,
            codeValidation.details
          )
        );
      }
      jobs.push({
        requestId: `batch-compile-${Date.now()}-${index}`,
        code: contract.code,
        dependencies: contract.dependencies || {},
      });
    }
    const results = await compileBatch(jobs);
    return res.json({
      success: true,
      status: 'success',
      queueLength: 0,
      activeWorkers: Math.min(4, contracts.length),
      results: results.map((result, index) => ({
        contractIndex: index,
        ...result,
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
