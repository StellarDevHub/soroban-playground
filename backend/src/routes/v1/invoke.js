import express from 'express';
import { asyncHandler, createHttpError } from '../middleware/errorHandler.js';
import { invokeSorobanContract } from '../services/invokeService.js';

const router = express.Router();

function validateInvokeRequest(body) {
  const { contractId, functionName, args, network, sourceAccount } = body || {};
  const errors = [];

  if (!contractId) {
    errors.push('contractId is required');
  } else if (
    typeof contractId !== 'string' ||
    !/^C[A-Z0-9]{55}$/.test(contractId)
  ) {
    errors.push('contractId must be a valid Stellar contract ID');
  }

  if (!functionName) {
    errors.push('functionName is required');
  } else if (
    typeof functionName !== 'string' ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(functionName)
  ) {
    errors.push('functionName must be a valid identifier');
  }

  if (
    args !== undefined &&
    args !== null &&
    (typeof args !== 'object' || Array.isArray(args))
  ) {
    errors.push('args must be an object');
  }

  if (
    network !== undefined &&
    network !== null &&
    typeof network !== 'string'
  ) {
    errors.push('network must be a string');
  }

  if (
    sourceAccount !== undefined &&
    sourceAccount !== null &&
    typeof sourceAccount !== 'string'
  ) {
    errors.push('sourceAccount must be a string');
  }

  return errors.length > 0 ? errors : null;
}

router.post(
  '/',
  asyncHandler(async (req, res, next) => {
    const errors = validateInvokeRequest(req.body);
    if (errors) {
      return next(createHttpError(400, 'Validation failed', errors));
    }

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
