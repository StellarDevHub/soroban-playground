import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { invokeSorobanContract } from '../../services/invokeService.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validation.js';
import { invokeBodyV1 } from '../../schemas/sorobanSchemas.js';

const router = express.Router();

router.post(
  '/',
  rateLimitMiddleware('invoke'),
  validateRequest({ body: invokeBodyV1 }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const requestId = `invoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());

    try {
      const result = await invokeSorobanContract(
        {
          requestId,
          contractId: req.body.contractId,
          functionName: req.body.functionName,
          args: req.body.args || {},
          network: req.body.network,
          sourceAccount: req.body.sourceAccount,
        },
        { signal: controller.signal }
      );

      return res.json({
        success: true,
        status: 'success',
        contractId: result.contractId,
        functionName: result.functionName,
        args: req.body.args || {},
        output: result.parsed,
        stdout: result.stdout,
        stderr: result.stderr,
        message: `Function "${result.functionName}" invoked successfully`,
        invokedAt: result.endedAt,
      });
    } catch (error) {
      const details = [
        error?.message || 'Soroban invocation failed',
        error?.stderr ? `stderr: ${error.stderr}` : null,
      ].filter(Boolean);
      return next(createHttpError(502, 'Invocation failed', details));
    }
  })
);

export default router;
