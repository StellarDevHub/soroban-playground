import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { invokeSorobanContract } from '../../services/invokeService.js';

const router = express.Router();

function validateInvokeRequest(body) {
  const { contract_id, function_name, args, network, source_account } =
    body || {};
  const errors = [];

  if (!contract_id) {
    errors.push('contract_id is required');
  } else if (
    typeof contract_id !== 'string' ||
    !/^C[A-Z0-9]{55}$/.test(contract_id)
  ) {
    errors.push('contract_id must be a valid Stellar contract ID');
  }

  if (!function_name) {
    errors.push('function_name is required');
  } else if (
    typeof function_name !== 'string' ||
    !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(function_name)
  ) {
    errors.push('function_name must be a valid identifier');
  }

  if (
    args !== undefined &&
    args !== null &&
    (typeof args !== 'object' || Array.isArray(args))
  ) {
    errors.push('args must be an object');
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

    const { contract_id, function_name, args, network, source_account } =
      req.body;

    const requestId = `invoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());

    try {
      const result = await invokeSorobanContract(
        {
          requestId,
          contractId: contract_id,
          functionName: function_name,
          args: args || {},
          network,
          sourceAccount: source_account,
        },
        { signal: controller.signal }
      );

      return res.json({
        success: true,
        status: 'success',
        contract_id: result.contractId,
        function_name: result.functionName,
        args: args || {},
        output: result.parsed,
        stdout: result.stdout,
        stderr: result.stderr,
        message: `Function "${result.functionName}" invoked successfully`,
        invoked_at: result.endedAt,
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
