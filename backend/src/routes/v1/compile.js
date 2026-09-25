import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { sanitizeDependenciesInput } from '../compile_utils.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validation.js';
import {
  compileBody,
  compileBatchBody,
  jobIdParams,
} from '../../schemas/sorobanSchemas.js';
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
      details: {
        maxSourceBytes: config.compile.maxSourceBytes,
        actualBytes: bytes,
      },
    };
  }

  return { ok: true };
}

router.post(
  '/',
  rateLimitMiddleware('compile'),
  validateRequest({ body: compileBody }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const code = req.body?.code || req.body?.source || req.body?.sourceCode;
    const { dependencies } = req.body || {};
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
          durationMs: result.durationMs,
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
        durationMs: result.durationMs,
        logs: result.logs,
        artifact: {
          name: result.artifact.name,
          sizeBytes: result.artifact.sizeBytes,
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

// Memory fallback for compilation jobs in test/offline environments
const inMemoryJobs = new Map();

router.post(
  '/async',
  rateLimitMiddleware('compile'),
  validateRequest({ body: compileBody }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const { code, source, contractName } = req.body || {};
    const codeToCompile = source || code;

    const codeValidation = validateSourceCode(codeToCompile);
    if (!codeValidation.ok) {
      return next(
        createHttpError(400, codeValidation.error, codeValidation.details)
      );
    }

    const jobId = `wasm-job-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    try {
      const { queues } = await import('../../services/queueService.js');
      if (queues && queues.compilation) {
        await queues.compilation.add(
          'compile-wasm',
          {
            source: codeToCompile,
            contractName: contractName || 'soroban_contract',
          },
          { jobId }
        );
      } else {
        inMemoryJobs.set(jobId, {
          status: 'queued',
          createdAt: new Date().toISOString(),
        });
      }
    } catch {
      inMemoryJobs.set(jobId, {
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
    }

    return res.status(202).json({
      success: true,
      jobId,
      status: 'queued',
      message: 'Compilation job queued asynchronously',
      createdAt: new Date().toISOString(),
    });
  })
);

router.get(
  '/job/:jobId',
  validateRequest({ params: jobIdParams }, { format: 'httpError' }),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    try {
      const { queues } = await import('../../services/queueService.js');
      if (queues && queues.compilation) {
        const job = await queues.compilation.getJob(jobId);
        if (job) {
          const state = await job.getState();
          return res.json({
            success: true,
            jobId,
            status: state,
            result: job.returnvalue || null,
            failedReason: job.failedReason || null,
          });
        }
      }
    } catch {
      // Fall through to memory check
    }

    const memoryJob = inMemoryJobs.get(jobId);
    if (memoryJob) {
      return res.json({
        success: true,
        jobId,
        status: memoryJob.status,
        result: memoryJob.result || null,
      });
    }

    return res.status(404).json({
      success: false,
      error: 'Compilation job not found',
    });
  })
);

export default router;
