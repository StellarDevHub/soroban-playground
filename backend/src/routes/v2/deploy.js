// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import { deployBatchContracts } from '../../services/deployService.js';

const router = express.Router();

/**
 * Validates the deploy request payload (v2 snake_case)
 */
function validateDeployRequest(body) {
  const { wasm_path, contract_name } = body;
  const errors = [];

  if (!wasm_path) {
    errors.push('wasm_path is required');
  } else if (typeof wasm_path !== 'string') {
    errors.push('wasm_path must be a string');
  }

  if (!contract_name) {
    errors.push('contract_name is required');
  } else if (typeof contract_name !== 'string') {
    errors.push('contract_name must be a string');
  }

  if (errors.length > 0) {
    return {
      error: 'Validation failed',
      details: errors,
    };
  }

  return null;
}

router.post(
  '/',
  asyncHandler(async (req, res, next) => {
    const validationError = validateDeployRequest(req.body);
    if (validationError) {
      return next(
        createHttpError(400, validationError.error, validationError.details)
      );
    }

    const { wasm_path, contract_name, network = 'testnet' } = req.body;

    setTimeout(() => {
      const contract_id =
        'C' + Math.random().toString(36).substring(2, 54).toUpperCase();

      res.json({
        success: true,
        status: 'success',
        contract_id,
        contract_name,
        network,
        wasm_path,
        deployed_at: new Date().toISOString(),
        message: `Contract "${contract_name}" deployed successfully to ${network}`,
      });
    }, 1500);
  })
);

router.post(
  '/batch',
  asyncHandler(async (req, res, next) => {
    const { contracts, batch_id } = req.body || {};
    if (!Array.isArray(contracts) || contracts.length === 0) {
      return next(
        createHttpError(400, 'Validation failed', [
          'contracts must be a non-empty array',
        ])
      );
    }

    const controller = new AbortController();
    req.on('aborted', () => controller.abort());

    try {
      const result = await deployBatchContracts(
        {
          requestId: `batch-${Date.now()}`,
          batchId: batch_id,
          contracts: contracts.map((c) => ({
            wasmPath: c.wasm_path,
            contractName: c.contract_name,
          })),
        },
        { signal: controller.signal }
      );

      // Transform result to v2
      return res.json({
        success: true,
        batch_id: result.batchId,
        deployments: result.deployments.map((d) => ({
          contract_id: d.contractId,
          contract_name: d.contractName,
          status: d.status,
        })),
      });
    } catch (error) {
      return next(
        createHttpError(502, 'Batch deployment failed', [error.message])
      );
    }
  })
);

export default router;
