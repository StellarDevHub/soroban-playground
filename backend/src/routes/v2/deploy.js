// Copyright (c) 2026 StellarDevTools
// SPDX-License-Identifier: MIT

import express from 'express';
import {
  asyncHandler,
  createHttpError,
} from '../../middleware/errorHandler.js';
import {
  deployBatchContracts,
  deployContract,
} from '../../services/deployService.js';
import { rateLimitMiddleware } from '../../middleware/rateLimiter.js';
import { validateRequest } from '../../middleware/validation.js';
import {
  deployBodyV2,
  deployBatchBodyV2,
} from '../../schemas/sorobanSchemas.js';

const router = express.Router();

router.post(
  '/',
  rateLimitMiddleware('deploy', {
    requiredScope: 'contracts:deploy',
  }),
  validateRequest({ body: deployBodyV2 }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const {
      wasm_path,
      contract_name,
      network = 'testnet',
      source_account,
    } = req.body;

    const contract = {
      id: contract_name,
      contractName: contract_name,
      wasmPath: wasm_path,
      network,
      sourceAccount: source_account,
    };

    try {
      const result = await deployContract(contract);
      return res.json({
        success: true,
        status: 'success',
        contract_id: result.contractId,
        contract_name,
        network,
        wasm_path,
        deployed_at: new Date().toISOString(),
        message: `Contract "${contract_name}" deployed successfully to ${network}`,
      });
    } catch (error) {
      return next(
        createHttpError(502, 'Contract deployment failed', [error.message])
      );
    }
  })
);

router.post(
  '/batch',
  rateLimitMiddleware('deploy', {
    requiredScope: 'contracts:deploy',
  }),
  validateRequest({ body: deployBatchBodyV2 }, { format: 'httpError' }),
  asyncHandler(async (req, res, next) => {
    const { contracts, batch_id } = req.body;

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
            network: c.network,
            sourceAccount: c.source_account,
            dependencies: c.dependencies,
          })),
        },
        { signal: controller.signal }
      );

      // Transform result to v2
      return res.json({
        success: true,
        batch_id: result.batchId,
        deployments: (result.deployments || result.contracts || []).map(
          (d) => ({
            contract_id: d.contractId,
            contract_name: d.contractName,
            status: d.status,
          })
        ),
      });
    } catch (error) {
      return next(
        createHttpError(502, 'Batch deployment failed', [error.message])
      );
    }
  })
);

export default router;
